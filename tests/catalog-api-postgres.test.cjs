const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { normalizeStateForSave, validateState } = require('../api/_lib/core.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const { readApplicationExportState } = require('../api/_lib/export-state.cjs')

function loadHandlers(root) {
  const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
  compiled.filename = filename
  compiled.paths = Module._nodeModulePaths(path.dirname(filename))
  compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testHandlers = { handleServiceCatalog, handleVehicles, ensureServicePhotoSchema };', filename)
  return compiled.exports.testHandlers
}

test('catalog handlers preserve both storage models, conflicts, no-ops and rollback in PostgreSQL', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..'), statements = []
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg, statements), handlers = loadHandlers(root)
    const original = {
      revision: 1, roles: [], employees: [], customers: [], reviews: [], preferences: { theme: 'light' },
      services: [{ id: 's', code: 'other-service', name: 'Otro servicio', status: 'Activo', estimatedMinutes: 60 }],
      vehicles: [{ id: 'v', brand: 'Ford', model: 'Ranger', year: 2025, mileage: 100, plate: 'AA123BB', insuranceExpiresOn: '' }],
      history: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, date: '2099-01-05', time: '09:00', status: 'Pendiente', estimatedMinutes: 60, serviceId: 's', service: 'Otro servicio' })),
      agenda: { date: '2099-01-05', teams: [], weekly: {} }
    }
    const initial = { ...normalizeStateForSave(original, original), revision: 1 }
    validateState(initial, initial)
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences (key,value) values ('state_revision','1') on conflict (key) do update set value='1'")
    const beforeMigrationExport = await readApplicationExportState(sql, { month: '2099-01' })
    assert.deepEqual(beforeMigrationExport.history, [])
    assert.equal(beforeMigrationExport.services.some(service => service.id === 's'), true)
    const user = { id: 'admin', roleCode: 'administrator', name: 'QA', role: 'Administrador', permissions: { services: true, vehicles: true } }
    const call = async (handler, body, operation) => {
      const response = {}
      const res = { setHeader() {}, status(status) { response.status = status; return this }, json(value) { response.body = value; return value } }
      await handler({ body }, res, sql, user, operation)
      return response
    }
    // The same command path works before the normalized schema is installed.
    const legacySaved = await call(handlers.handleVehicles, { base: initial.vehicles[0], vehicle: { ...initial.vehicles[0], mileage: 120 } }, { operation: 'update', vehicleId: 'v' })
    assert.equal(legacySaved.status, 200, JSON.stringify(legacySaved.body))
    assert.equal((await readState(sql)).vehicles[0].mileage, 120)
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const legacy = await readState(sql), candidate = buildShadowCandidate(legacy)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [legacy.revision, candidate.analysis.sourceFingerprint])
    const service = legacy.services.find(record => record.id === 's')
    const saved = await call(handlers.handleServiceCatalog, { base: service, service: { ...service, name: 'Servicio actualizado' } }, { operation: 'update', serviceId: 's' })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.service.name, 'Servicio actualizado')
    assert.deepEqual(await readNormalizedState(pg), await readState(sql))
    const conflict = await call(handlers.handleServiceCatalog, { base: service, service: { ...service, name: 'Obsoleto' } }, { operation: 'update', serviceId: 's' })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'SERVICE_WRITE_CONFLICT')
    const updatedVehicle = { ...legacySaved.body.vehicle, mileage: 140 }
    const vehicleSaved = await call(handlers.handleVehicles, { base: legacySaved.body.vehicle, vehicle: updatedVehicle }, { operation: 'update', vehicleId: 'v' })
    assert.equal(vehicleSaved.status, 200, JSON.stringify(vehicleSaved.body))
    const beforeNoop = await readState(sql)
    const auditsBefore = (await pg.query('select count(*)::int as count from pignus_audit_log')).rows[0].count
    const noop = await call(handlers.handleVehicles, { base: vehicleSaved.body.vehicle, vehicle: vehicleSaved.body.vehicle }, { operation: 'update', vehicleId: 'v' })
    assert.equal(noop.status, 200)
    assert.equal(noop.body.revision, beforeNoop.revision)
    assert.equal((await pg.query('select count(*)::int as count from pignus_audit_log')).rows[0].count, auditsBefore)
    const originalQuery = sql.query
    sql.query = async (statement, parameters) => {
      if (/insert into normalized_shadow.audit_events/.test(statement)) throw new Error('injected audit failure')
      return originalQuery(statement, parameters)
    }
    const nextCommand = { base: vehicleSaved.body.vehicle, vehicle: { ...vehicleSaved.body.vehicle, mileage: 160 } }
    const failed = await call(handlers.handleVehicles, nextCommand, { operation: 'update', vehicleId: 'v' })
    assert.equal(failed.status, 400)
    sql.query = originalQuery
    assert.deepEqual(await readState(sql), beforeNoop)
    assert.deepEqual(await readNormalizedState(pg), beforeNoop)
    const retried = await call(handlers.handleVehicles, nextCommand, { operation: 'update', vehicleId: 'v' })
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
    assert.equal((await readState(sql)).vehicles[0].mileage, 160)
    assert.deepEqual(await readNormalizedState(pg), await readState(sql))

    // A legacy installation repairs its missing attachment schema once per pool.
    await pg.exec('drop table pignus_service_photos')
    statements.length = 0
    await handlers.ensureServicePhotoSchema(sql)
    await handlers.ensureServicePhotoSchema(sql)
    assert.equal(statements.filter(statement => /create table if not exists pignus_service_photos/.test(statement)).length, 1)
    assert.equal((await pg.query("select relrowsecurity from pg_class where oid='pignus_service_photos'::regclass")).rows[0].relrowsecurity, true)

    // Deliberately diverging read fixtures prove selection uses the active model.
    const fixtureRecords = [
      { id: 'a', date: '2099-01-05', status: 'Completado', technicianIds: [1, '2'] },
      { id: 'b', date: '2099-01-06', status: 'Completado', technicianIds: ['3'] },
      { id: 'c', date: '2099-01-07', status: 'Pendiente', technicianIds: ['1'] },
      { id: 'd', date: '2098-12-31', status: 'Completado', technicianIds: ['1'] },
      { id: 'e', date: '2099-01-08', status: 'Completado', technicianIds: null }
    ]
    for (const record of fixtureRecords) {
      await pg.query('update pignus_work_history set data=$1 where id=$2', [JSON.stringify({ ...record, detail: 'legacy' }), record.id])
      await pg.query('update normalized_shadow.history_evidence set original_payload=$1 where job_id=$2', [JSON.stringify({ ...record, detail: 'normalized' }), record.id])
    }
    statements.length = 0
    const normalizedExport = await readApplicationExportState(sql, { month: '2099-01', technicianId: '1' })
    assert.deepEqual(normalizedExport.history.map(record => [record.id, record.detail]), [['a', 'normalized']])
    assert.ok(statements.every(statement => !/employee_credentials|pignus_customers|agenda_plan_evidence/.test(statement)))
    const adminExport = await readApplicationExportState(sql, { month: '2099-01' })
    assert.deepEqual(adminExport.history.map(record => record.id), ['a', 'b', 'e'])
    const explicitLegacy = await readApplicationExportState(sql, { month: '2099-01', technicianId: '1', environment: { PIGNUS_STORAGE_MODE: 'legacy' } })
    assert.deepEqual(explicitLegacy.history.map(record => [record.id, record.detail]), [['a', 'legacy']])
    await pg.query("update normalized_shadow.storage_control set active_model='legacy' where id=1")
    const selectedLegacy = await readApplicationExportState(sql, { month: '2099-01', technicianId: '1' })
    assert.deepEqual(selectedLegacy, explicitLegacy)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=active_revision+1 where id=1")
    await assert.rejects(readApplicationExportState(sql, { month: '2099-01' }), { code: 'STORAGE_CONTROL_READ_CONFLICT' })
  } finally { await pg.close() }
})
