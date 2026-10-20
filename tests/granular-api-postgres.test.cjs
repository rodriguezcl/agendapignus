const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture } = require('./helpers/planning-click-fixture.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { visibleStateForUser } = require('../api/_lib/core.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const actor = keys => ({ id: 'planner', roleCode: 'operator', name: 'Prueba', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) } })

test('PostgreSQL granular writes preserve hidden fields, exact permissions, CAS, audit rollback and both storage models', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..')
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), initial = fixture()
    initial.vehicles = [{ id: 'v', brand: 'Ford', model: 'Ka', plate: 'ABC123', year: 2024, mileage: 1 }]
    const template = initial.agenda.weekly[initial.agenda.date].teams[0]
    initial.agenda.weekly._monthlyTeams = { '2099-01': { teams: [{ teamId: template.teamId, label: template.label, memberIds: template.memberIds, members: template.members }], vehicleAssignments: [{ vehicleId: 'v', technicianId: 'one' }] } }
    initial.history[0] = { ...initial.history[0], amount: '900', paymentMethod: 'Efectivo', address: 'Privada', phone: '123', internalNote: 'Antes', technicalObservation: 'Privado' }
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const candidate = buildShadowCandidate(initial)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [initial.revision, candidate.analysis.sourceFingerprint])
    const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave=handleSaveState; module.exports.testHistory=handleHistoryRecordUpdate; module.exports.testPhoto=handleServicePhoto;', filename)
    const call = async (body, user, handler = 'testSave', method = 'PATCH') => {
      const response = {}
      const res = { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
      try { await compiled.exports[handler]({ method, body }, res, sql, user, 'work') }
      catch (error) { response.status = error.statusCode || 500; response.body = { error: error.message } }
      return response
    }
    const user = actor(['weekly.view', 'history.view', 'records.read', 'planning.notes'])
    const before = await readState(sql), visible = visibleStateForUser(before, user)
    assert.equal(visible.history[0].amount, undefined)
    assert.equal(visible.history[0].technicalObservation, undefined)
    const proposed = structuredClone(visible); proposed.history[0].internalNote = 'Después'
    const response = await call({ revision: 1, operations: stateOperations(visible, proposed) }, user)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const saved = await readState(sql)
    assert.equal(saved.history[0].internalNote, 'Después')
    assert.equal(saved.history[0].amount, '900')
    assert.equal(saved.history[0].phone, '123')
    assert.equal(saved.history[0].technicalObservation, 'Privado')
    assert.deepEqual(await readNormalizedState(pg), saved)
    const auditCount = async () => (await pg.query('select count(*)::int as count from pignus_audit_log')).rows[0].count
    const beforeAudit = await auditCount()
    const nextVisible = visibleStateForUser(saved, user), denied = structuredClone(nextVisible)
    denied.history[0].detail = 'No autorizado'
    const rejection = await call({ revision: saved.revision, operations: stateOperations(nextVisible, denied) }, user)
    assert.equal(rejection.status, 403, JSON.stringify(rejection.body))
    assert.deepEqual(await readState(sql), saved)
    assert.equal(await auditCount(), beforeAudit)
    const direct = await call({ base: nextVisible.history[0], record: { ...nextVisible.history[0], detail: 'No autorizado' } }, user, 'testHistory')
    assert.equal(direct.status, 403, JSON.stringify(direct.body))
    const note = { ...nextVisible.history[0], internalNote: 'Cambio directo' }
    const allowed = await call({ base: nextVisible.history[0], record: note }, user, 'testHistory')
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
    assert.equal(allowed.body.state.history[0].amount, undefined)
    const conflict = await call({ base: nextVisible.history[0], record: { ...note, internalNote: 'Viejo' } }, user, 'testHistory')
    assert.equal(conflict.status, 409)
    const latest = await readState(sql)
    assert.equal(latest.history[0].amount, '900')
    assert.deepEqual(await readNormalizedState(pg), latest)
    const lastProjection = visibleStateForUser(latest, user), rollback = structuredClone(lastProjection)
    rollback.history[0].internalNote = 'Rollback'
    const originalQuery = sql.query, count = await auditCount()
    sql.query = async (statement, parameters) => {
      if (/insert into normalized_shadow.audit_events/.test(statement)) throw new Error('Injected final audit failure')
      return originalQuery(statement, parameters)
    }
    const failure = await call({ revision: latest.revision, operations: stateOperations(lastProjection, rollback) }, user)
    sql.query = originalQuery
    assert.equal(failure.status, 400)
    assert.deepEqual(await readState(sql), latest)
    assert.deepEqual(await readNormalizedState(pg), latest)
    assert.equal(await auditCount(), count)
    const photo = { photo: 'data:image/jpeg;base64,' + Buffer.from('test-image').toString('base64') }
    const files = { ...actor(['history.view', 'records.read', 'service.documents.read', 'service.documents.upload', 'service.documents.deleteOwn']), id: 'one' }
    assert.equal((await call(photo, { id: 'admin', roleCode: 'administrator' }, 'testPhoto', 'POST')).status, 200)
    assert.equal((await call(photo, files, 'testPhoto', 'POST')).status, 403, 'upload may not replace a photo owned by somebody else')
    assert.equal((await call({}, { id: 'admin', roleCode: 'administrator' }, 'testPhoto', 'DELETE')).status, 200)
    assert.equal((await call(photo, files, 'testPhoto', 'POST')).status, 200)
    assert.equal((await call({}, files, 'testPhoto', 'DELETE')).status, 200)
    assert.equal((await call({}, files, 'testPhoto', 'DELETE')).status, 200, 'repeated authorized deletion is idempotent')
    const { buildVehicleControlRecords, vehicleControlTask } = await import('../src/domain/vehicles/vehicle-controls.mjs')
    const scheduler = actor(['weekly.view', 'weekly.monthlyVehicles.read', 'weekly.controls.schedule'])
    const controlBaseline = await readState(sql), controlView = visibleStateForUser(controlBaseline, scheduler)
    const config = controlView.agenda.weekly._monthlyTeams['2099-01']
    const controls = buildVehicleControlRecords({ month: '2099-01', assignments: config.vehicleAssignments, vehicles: controlView.vehicles, technicians: controlView.employees, teams: config.teams, fromDate: '2099-01-01' })
    const scheduled = structuredClone(controlView)
    scheduled.history.push(...controls)
    for (const control of controls) scheduled.agenda.weekly[control.date] = { teams: config.teams.map(team => ({ ...team, tasks: team.memberIds.map(String).includes(String(control.technicianIds[0])) ? [vehicleControlTask(control)] : [] })) }
    const scheduledResponse = await call({ revision: controlBaseline.revision, operations: stateOperations(controlView, scheduled) }, scheduler)
    assert.equal(scheduledResponse.status, 200, JSON.stringify(scheduledResponse.body))
    const controlsSaved = await readState(sql)
    assert.equal(controlsSaved.history.filter(record => record.vehicleControl).length, controls.length)
    assert.deepEqual(controlsSaved.agenda.weekly._monthlyTeams, controlBaseline.agenda.weekly._monthlyTeams, 'scheduling does not edit the confirmed assignments')
    const normalizedControls = await readNormalizedState(pg)
    const byId = (left, right) => String(left.id).localeCompare(String(right.id))
    assert.deepEqual({ ...normalizedControls, history: normalizedControls.history.toSorted(byId) }, { ...controlsSaved, history: controlsSaved.history.toSorted(byId) })
  } finally { await pg.close() }
})

test('role notification preferences persist through the real PATCH path and both storage models, refreshing session permissions', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const { userForEmployee } = require('../api/_lib/core.cjs')
  const catalog = require('../api/_lib/permission-catalog.cjs')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..')
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), initial = fixture()
    const manager = {
      id: 'billing-manager', name: 'Gestión de cobranza', code: 'billing-manager',
      permissions: {
        __catalogV2: true, 'collections.view': true, 'records.financial': true,
        'settings.view': true, 'settings.roles.read': true, 'settings.roles.permissions': true
      }
    }
    initial.roles.push(manager, { id: 'admin', name: 'Administrador', code: 'administrator', permissions: {} })
    initial.employees[0].roleId = manager.id
    initial.employees.push({ id: 'admin', firstName: 'Admin', lastName: 'Prueba', email: 'admin@example.test', roleId: 'admin', status: 'Activo' })
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const candidate = buildShadowCandidate(initial)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [initial.revision, candidate.analysis.sourceFingerprint])

    const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave=handleSaveState;', filename)
    const user = userForEmployee(initial.employees[0], initial.roles)
    const before = await readState(sql), visible = visibleStateForUser(before, user)
    assert.equal(Object.hasOwn(user.permissions, 'notifications.collections'), false)
    assert.equal(catalog.can(visible.sessionUser, 'notifications.collections'), true, 'A preexisting role inherits notices from effective reading permissions')
    const proposed = structuredClone(visible)
    proposed.roles.find(role => role.id === manager.id).permissions['notifications.collections'] = false
    const operations = stateOperations(visible, proposed)
    assert.equal(operations.length, 1)
    assert.equal(operations[0].path[0], 'roles')
    const response = {}
    const res = { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
    await compiled.exports.testSave({ method: 'PATCH', body: { revision: before.revision, operations } }, res, sql, user)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(response.body.state.sessionUser.permissions['notifications.collections'], false)
    assert.equal(catalog.can(response.body.state.sessionUser, 'notifications.collections'), false)
    assert.equal(catalog.can(response.body.state.sessionUser, 'collections.view'), true)
    assert.equal(catalog.can(response.body.state.sessionUser, 'records.financial'), true)

    const saved = await readState(sql), normalized = await readNormalizedState(pg)
    assert.equal(saved.roles.find(role => role.id === manager.id).permissions['notifications.collections'], false)
    assert.equal(normalized.roles.find(role => role.id === manager.id).permissions['notifications.collections'], false)
    const byId = (left, right) => String(left.id).localeCompare(String(right.id))
    const comparable = snapshot => ({ ...snapshot, roles: snapshot.roles.toSorted(byId), employees: snapshot.employees.toSorted(byId) })
    assert.deepEqual(comparable(normalized), comparable(saved))
    assert.deepEqual((await pg.query('select allowed from normalized_shadow.role_permissions where role_id=$1 and permission=$2', [manager.id, 'notifications.collections'])).rows, [{ allowed: false }])
    const refreshed = visibleStateForUser(saved, user)
    assert.equal(refreshed.sessionUser.permissions['notifications.collections'], false, 'Stale caller metadata is replaced by persisted permissions')
    assert.equal(catalog.can(refreshed.sessionUser, 'notifications.collections'), false)
    assert.equal(refreshed.history.length, visible.history.length, 'Muting a notice preserves the independent data-reading permission')
    assert.equal(saved.revision, before.revision + 1)
  } finally { await pg.close() }
})
