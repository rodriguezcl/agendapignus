const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createCctvStore } = require('../api/_lib/cctv-store.cjs')
const { MAX_FILE_BYTES } = require('../api/_lib/cctv-attachments.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')

const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const supervisor = { id: 'supervisor', name: 'Supervisión CCTV', roleCode: 'supervisor' }
const tech = { id: 'tech', name: 'Técnico asignado', roleCode: 'technician' }
const fixture = () => ({
  employees: [admin, supervisor, tech].map(user => ({ id: user.id, name: user.name, status: 'Activo' })),
  customers: ['a', 'b', 'off'].map(customerId => ({ customerId, account: `PIG-${customerId}`, name: `Cuenta ${customerId}`, cctvService: customerId !== 'off', address: 'Calle 123', phone: '123', email: 'cliente@example.test', locality: 'Córdoba', cctvRequirement: 'Requiere llave de ingreso', monthlyFee: 999, collection: { sensitive: true } })),
  history: [{ id: 'work', customerId: 'a', date: '2099-01-01', status: 'Pendiente', technicianIds: ['tech'] }], agenda: { weekly: {} }
})
const pdf = Buffer.from('%PDF-1.4\nExample\n%%EOF\n')
const fileFor = (bytes = pdf, mimeType = 'application/pdf') => ({ fileName: 'informe.pdf', mimeType, data: bytes.toString('base64') })
const command = (action, payload, expectedVersion = 0, extra = {}) => ({ commandId: randomUUID(), customerId: 'a', expectedVersion, action, payload, ...extra })
const rejects = (fn, statusCode, code) => assert.rejects(fn, error => error.statusCode === statusCode && (!code || error.code === code))
const equipment = { id: 'recorder', category: 'cctv', kind: 'nvr', label: 'Grabador', brand: 'Marca', model: 'Modelo', quantity: 2, location: 'Garita', details: { channels: 16, diskCount: 2, diskCapacityTb: 4 }, notes: '' }

async function environment(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON')
    return { store: createCctvStore({ db }), connection: db, kind: 'db', query: (sql, values = []) => db.prepare(sql).all(...values), exec: sql => db.exec(sql), close: () => db.close() }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;')
  const sql = pgliteAdapter(pg)
  // PGlite has one connection. Its transaction API queues competing commands
  // while production PostgreSQL serializes them with per-customer row locks.
  sql.begin = callback => pg.transaction(tx => callback(pgliteAdapter(tx)))
  return { store: createCctvStore({ sql }), connection: sql, kind: 'sql', query: async (sql, values = []) => (await pg.query(sqlParameters(sql), values)).rows, exec: sql => pg.exec(sql), close: () => pg.close() }
}

for (const engine of ['sqlite', 'postgres']) {
  test(`CCTV ${engine}: expediente independiente, cuentas canónicas y permisos de consulta/edición`, async () => {
    const env = await environment(engine), state = fixture(), original = structuredClone(state)
    try {
      const empty = await env.store.detail(admin, state, 'a')
      assert.equal(empty.dossier.version, 0)
      assert.deepEqual(empty.dossier.news, [])
      assert.deepEqual((await env.store.list(admin, state)).customers.map(item => item.customerId), ['a', 'b'])
      assert.deepEqual((await env.store.list(tech, state)).customers.map(item => item.customerId), ['a'])
      assert.equal((await env.store.detail(tech, state, 'a')).capabilities.edit, false)
      await rejects(() => env.store.detail(tech, state, 'b'), 404)
      await rejects(() => env.store.detail(admin, state, 'off'), 404)
      await rejects(() => env.store.run(tech, state, command('addNews', { title: 'No permitido', body: 'No debe guardarse' })), 403)
      const saved = await env.store.run(supervisor, state, command('addNews', { title: 'Nueva cámara', body: 'Cámara instalada.', author: { id: 'forged' }, at: '2000-01-01' }))
      assert.equal(saved.dossier.version, 1)
      assert.equal(saved.dossier.news[0].author.id, supervisor.id)
      assert.ok(saved.dossier.news[0].at > '2020')
      assert.equal(saved.customer.monthlyFee, undefined)
      assert.equal(saved.customer.collection, undefined)
      assert.deepEqual(state, original, 'El estado compartido no contiene el expediente ni se modifica')
      const disabled = structuredClone(state); disabled.customers[0].cctvService = false
      assert.equal((await env.store.list(admin, disabled)).customers.some(item => item.customerId === 'a'), false)
      await rejects(() => env.store.detail(admin, disabled, 'a'), 404)
      assert.equal((await env.store.detail(admin, state, 'a')).dossier.news.length, 1, 'Volver a habilitar conserva el historial')
      const inactive = structuredClone(state); inactive.employees.find(item => item.id === tech.id).status = 'Inactivo'
      await rejects(() => env.store.detail(tech, inactive, 'a'), 404)
    } finally { await env.close() }
  })

  test(`CCTV ${engine}: concurrencia por cuenta y reintentos idempotentes no duplican aportes`, async () => {
    const env = await environment(engine), state = fixture()
    try {
      await env.store.ensure()
      const first = command('addNews', { title: 'Primera', body: 'Una sola vez', file: fileFor() })
      const attempts = await Promise.all([env.store.run(admin, state, first), env.store.run(admin, state, first)])
      assert.equal(attempts[0].dossier.version, 1); assert.deepEqual(attempts[0], attempts[1])
      const competing = await Promise.allSettled([
        env.store.run(admin, state, command('addNews', { title: 'A', body: 'Sesión A' }, 1)),
        env.store.run(admin, state, command('addNews', { title: 'B', body: 'Sesión B' }, 1))
      ])
      assert.equal(competing.filter(item => item.status === 'fulfilled').length, 1)
      const rejected = competing.find(item => item.status === 'rejected').reason
      assert.equal(rejected.code, 'CCTV_VERSION_CONFLICT'); assert.equal(rejected.currentVersion, 2)
      assert.equal((await env.store.run(admin, state, first)).dossier.version, 2, 'Un reintento devuelve la versión vigente sin reaplicar')
      assert.equal((await env.query('SELECT id FROM pignus_cctv_attachments')).length, 1)
      assert.equal((await env.query('SELECT id FROM pignus_cctv_commands')).length, 2)
      await rejects(() => env.store.run(admin, state, { ...first, payload: { ...first.payload, body: 'Distinto' } }), 409, 'CCTV_COMMAND_CONFLICT')
      await rejects(() => env.store.run(supervisor, state, first), 409, 'CCTV_COMMAND_CONFLICT')
      await rejects(() => env.store.run(admin, state, { ...first, customerId: 'b' }), 409, 'CCTV_COMMAND_CONFLICT')
      const other = await env.store.run(admin, state, command('addNews', { title: 'Otra cuenta', body: 'Versión propia' }, 0, { customerId: 'b' }))
      assert.equal(other.dossier.version, 1)
    } finally { await env.close() }
  })

  test(`CCTV ${engine}: trazabilidad, planos versionados, mejoras y equipamiento conservan autoría`, async () => {
    const env = await environment(engine), state = fixture()
    try {
      let result = await env.store.run(admin, state, command('saveMaintenance', { observation: 'Limpieza de lentes', nextDate: '2027-01-20' }))
      result = await env.store.run(supervisor, state, command('saveMaintenance', { observation: 'Limpieza y revisión', nextDate: '2027-02-20' }, 1))
      assert.equal(result.dossier.activity[1].details.before.observation, 'Limpieza de lentes')
      assert.equal(result.dossier.activity[1].details.after.observation, 'Limpieza y revisión')
      assert.equal(result.dossier.maintenance.author.id, supervisor.id)
      const drawing = { width: 1000, height: 650, elements: [
        { id: 'camera', type: 'camera', x: 20, y: 40, label: 'Ingreso', model: 'IPC-HFW3449T1-AS-PV-PRO' },
        { id: 'wall', type: 'wall', x: 20, y: 60, x2: 175, y2: 60, label: 'Frente' }
      ] }
      result = await env.store.run(admin, state, command('addPlan', { title: 'Plano inicial', notes: 'Ingreso', drawing }, 2))
      const oldPlan = structuredClone(result.dossier.plans[0])
      assert.deepEqual(oldPlan.drawing, drawing)
      result = await env.store.run(admin, state, command('addPlan', { title: 'Plano actualizado', file: fileFor() }, 3))
      assert.deepEqual(result.dossier.plans[0], oldPlan)
      assert.equal(result.dossier.plans[1].version, 2)
      result = await env.store.run(admin, state, command('addImprovement', { title: 'Iluminación', description: 'Mejorar entrada', priority: 'Alta' }, 4))
      const improvement = result.dossier.improvements[0]
      assert.equal((await env.store.list(admin, state)).customers[0].pendingImprovements, 1)
      result = await env.store.run(supervisor, state, command('toggleImprovement', { id: improvement.id, completed: true }, 5))
      assert.equal(result.dossier.improvements[0].completedBy.id, supervisor.id)
      result = await env.store.run(admin, state, command('toggleImprovement', { id: improvement.id, completed: false }, 6))
      assert.equal(result.dossier.improvements[0].completedAt, null)
      assert.equal(result.dossier.activity[5].details.after, true)
      result = await env.store.run(admin, state, command('saveEquipment', { items: [equipment] }, 7))
      result = await env.store.run(admin, state, command('saveEquipment', { items: [{ ...equipment, quantity: 3 }] }, 8))
      assert.equal(result.dossier.activity[8].details.before[0].quantity, 2)
      assert.equal((await env.store.list(admin, state)).customers[0].equipmentCount, 3)
      assert.equal(result.dossier.activity.length, 9)
      assert.ok(result.dossier.activity.every(item => item.at && item.author.id))
      await rejects(() => env.store.run(admin, state, command('saveEquipment', {}, 9)), 400)
      await rejects(() => env.store.run(admin, state, command('addPlan', { title: 'HTML', drawing: { width: 1000, height: 650, elements: [], svg: '<svg onload="x" />' } }, 9)), 400)
      assert.equal((await env.store.detail(admin, state, 'a')).dossier.version, 9)
    } finally { await env.close() }
  })

  test(`CCTV ${engine}: cada versión del plano usa equipos y cantidades de su propia ficha`, async () => {
    const env = await environment(engine), state = fixture()
    const item = { ...equipment, id: 'nvr-a' }
    const marker = { id: 'norte', type: 'recorder', equipmentId: item.id, label: 'Acceso norte', x: 15, y: 30 }
    const second = { ...marker, id: 'sur', label: 'Acceso sur', x: 300 }
    const payload = (...elements) => ({ title: 'Equipos instalados', drawing: { width: 1000, height: 650, elements } })
    try {
      await env.store.run(admin, state, command('saveEquipment', { items: [item] }))
      await env.store.run(admin, state, command('saveEquipment', { items: [{ ...item, id: 'nvr-b' }] }, 0, { customerId: 'b' }))
      await rejects(() => env.store.run(admin, state, command('addPlan', payload({ ...marker, equipmentId: 'nvr-b' }), 1)), 400)
      await rejects(() => env.store.run(admin, state, command('addPlan', payload({ ...marker, type: 'alarm' }), 1)), 400)
      await rejects(() => env.store.run(admin, state, command('addPlan', payload({ ...marker, type: 'text' }), 1)), 400)
      await rejects(() => env.store.run(admin, state, command('addPlan', payload(marker, second, { ...marker, id: 'tercero' }), 1)), 400)
      const create = command('addPlan', payload({ ...marker, model: 'Otro modelo', brand: 'Otra marca' }, second), 1)
      const saved = await env.store.run(supervisor, state, create)
      const original = saved.dossier.plans[0].drawing
      assert.deepEqual(original.elements, [marker, second].map(entry => ({ ...entry, model: item.model, brand: item.brand })))
      await env.store.run(admin, state, command('saveEquipment', { items: [{ ...item, quantity: 1, model: '', brand: 'Marca nueva' }] }, 2))
      await rejects(() => env.store.run(supervisor, state, command('addPlan', payload(marker), 2)), 409, 'CCTV_VERSION_CONFLICT')
      const latest = await env.store.run(admin, state, command('addPlan', payload({ ...marker, model: item.model }), 3))
      assert.deepEqual(latest.dossier.plans[1].drawing.elements, [{ ...marker, brand: 'Marca nueva' }])
      await env.store.run(admin, state, command('saveEquipment', { items: [] }, 4))
      await rejects(() => env.store.run(admin, state, command('addPlan', payload(marker), 5)), 400)
      const detail = await env.store.detail(tech, state, 'a')
      assert.deepEqual(detail.dossier.plans[0].drawing, original)
      assert.deepEqual(detail.dossier.plans[1], latest.dossier.plans[1])
      assert.deepEqual(detail.dossier.equipment, [])
    } finally { await env.close() }
  })

  test(`CCTV ${engine}: bytes separados, descargas autorizadas y adjuntos aislados por cuenta`, async () => {
    const env = await environment(engine), state = fixture()
    try {
      const saved = await env.store.run(admin, state, command('addNews', { title: 'Informe', body: 'Documento', file: { ...fileFor(), fileName: '../documento\n.pdf' } }))
      const attachment = saved.dossier.news[0].file
      assert.equal(attachment.data, undefined); assert.equal(attachment.byteSize, pdf.length)
      assert.ok(!attachment.fileName.includes('/') && !attachment.fileName.includes('\n'))
      assert.deepEqual((await env.store.attachment(tech, state, 'a', attachment.id)).data, pdf)
      const reader = { id: 'reader', roleCode: 'custom', permissions: { __catalogV2: true, 'cctv.view': true } }
      assert.equal((await env.store.detail(reader, state, 'a')).customer.phone, undefined)
      await rejects(() => env.store.attachment(reader, state, 'a', attachment.id), 403)
      await rejects(() => env.store.attachment(admin, state, 'b', attachment.id), 404, 'CCTV_ATTACHMENT_NOT_FOUND')
      await rejects(() => env.store.attachment(tech, state, 'b', attachment.id), 404)
      const raw = (await env.query('SELECT data FROM pignus_cctv_dossiers WHERE customer_id=?', ['a']))[0].data
      assert.ok(!raw.includes(pdf.toString('base64')))
      assert.equal((await env.query('SELECT byte_size FROM pignus_cctv_attachments'))[0].byte_size, pdf.length)
      const disabled = structuredClone(state); disabled.customers[0].cctvService = false
      await rejects(() => env.store.attachment(admin, disabled, 'a', attachment.id), 404)
      if (engine === 'postgres') {
        const tables = await env.query("SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('pignus_cctv_dossiers','pignus_cctv_attachments','pignus_cctv_commands')")
        assert.equal(tables.length, 3); assert.ok(tables.every(row => row.relrowsecurity))
        for (const table of tables) assert.equal((await env.query("SELECT has_table_privilege('anon',?,'SELECT') AS allowed", [table.relname]))[0].allowed, false)
      }
    } finally { await env.close() }
  })

  test(`CCTV ${engine}: validaciones de archivos, límites y errores no dejan escrituras parciales`, async () => {
    const env = await environment(engine), state = fixture()
    try {
      await env.store.ensure()
      const invalidFiles = [fileFor(Buffer.from('texto'), 'application/pdf'), fileFor(pdf, 'image/png'), { ...fileFor(), data: '%%%=' }, { ...fileFor(), data: '' }, fileFor(Buffer.alloc(MAX_FILE_BYTES + 1, 65))]
      for (const file of invalidFiles) await rejects(() => env.store.run(admin, state, command('addNews', { title: 'Informe', body: 'Texto', file })), 400)
      await rejects(() => env.store.run(admin, state, command('addNews', { title: '', body: 'Texto', file: fileFor() })), 400)
      await rejects(() => env.store.run(admin, state, command('saveMaintenance', { observation: 'Prueba', nextDate: '2026-02-30' })), 400)
      assert.equal((await env.query('SELECT customer_id FROM pignus_cctv_dossiers')).length, 0)
      assert.equal((await env.query('SELECT id FROM pignus_cctv_commands')).length, 0)
      assert.equal((await env.query('SELECT id FROM pignus_cctv_attachments')).length, 0)
      const maximum = Buffer.alloc(MAX_FILE_BYTES); pdf.copy(maximum)
      const result = await env.store.run(admin, state, command('addNews', { title: 'Límite', body: '3 MB', file: fileFor(maximum) }))
      assert.equal(result.dossier.news[0].file.byteSize, MAX_FILE_BYTES)
      const images = [
        [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), 'image/png'],
        [Buffer.from([255, 216, 255, 0]), 'image/jpeg'],
        [Buffer.from('RIFF0000WEBPdata'), 'image/webp']
      ]
      let version = 1
      for (const [bytes, mime] of images) {
        await rejects(() => env.store.run(admin, state, command('addNews', { title: 'No PDF', body: 'Texto', file: fileFor(bytes, mime) }, version)), 400)
        const plan = await env.store.run(admin, state, command('addPlan', { title: 'Plano imagen', file: fileFor(bytes, mime) }, version++))
        assert.equal(plan.dossier.plans.at(-1).file.mimeType, mime)
      }
    } finally { await env.close() }
  })

  test(`CCTV ${engine}: fallo de persistencia revierte ficha, adjunto y comando en una sola transacción`, async () => {
    const env = await environment(engine), state = fixture()
    try {
      await env.store.ensure()
      if (engine === 'sqlite') await env.exec("CREATE TRIGGER cctv_failure BEFORE INSERT ON pignus_cctv_commands BEGIN SELECT RAISE(ABORT,'cctv simulated failure'); END;")
      else await env.exec("CREATE FUNCTION cctv_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cctv simulated failure'; END $$; CREATE TRIGGER cctv_failure BEFORE INSERT ON pignus_cctv_commands FOR EACH ROW EXECUTE FUNCTION cctv_failure();")
      const input = command('addNews', { title: 'Reintentar', body: 'No debe quedar incompleto', file: fileFor() })
      await assert.rejects(() => env.store.run(admin, state, input), /cctv simulated failure/)
      for (const table of ['pignus_cctv_dossiers', 'pignus_cctv_attachments', 'pignus_cctv_commands']) assert.equal((await env.query(`SELECT * FROM ${table}`)).length, 0)
      await env.exec(engine === 'sqlite' ? 'DROP TRIGGER cctv_failure' : 'DROP TRIGGER cctv_failure ON pignus_cctv_commands; DROP FUNCTION cctv_failure();')
      const retry = await env.store.run(admin, state, input)
      assert.equal(retry.dossier.version, 1)
      assert.equal(retry.dossier.news.length, 1)
      assert.equal((await env.query('SELECT * FROM pignus_cctv_attachments')).length, 1)
    } finally { await env.close() }
  })
}

test('CCTV HTTP: rutas, respuesta de conflictos y descarga conservan contrato seguro', async () => {
  const { cctvRequest, cctvError, attachmentHeaders } = require('../api/_lib/cctv-http.cjs')
  const env = await environment('sqlite'), state = fixture()
  const request = (method, route, input = {}, query = {}) => cctvRequest({ connection: env.connection, kind: env.kind, user: admin, state, method, route, input, query })
  try {
    assert.equal((await request('GET', '/cctv')).body.customers.length, 2)
    assert.equal((await request('GET', '/cctv', {}, { customerId: 'a' })).body.dossier.version, 0)
    const created = (await request('POST', '/cctv', command('addNews', { title: 'Documento', body: 'Consulta', file: fileFor() }))).body
    const downloaded = (await request('GET', '/cctv/attachments', {}, { customerId: 'a', attachmentId: created.dossier.news[0].file.id })).file
    assert.deepEqual(downloaded.data, pdf)
    const headers = attachmentHeaders(downloaded)
    assert.equal(headers['Content-Type'], 'application/pdf')
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    assert.ok(headers['Content-Security-Policy'].includes('sandbox'))
    await rejects(() => request('DELETE', '/cctv'), 405)
    try { await request('POST', '/cctv', command('addNews', { title: 'Stale', body: 'Conflict' })) } catch (error) {
      assert.deepEqual(cctvError(error), { status: 409, body: { error: error.message, code: 'CCTV_VERSION_CONFLICT', currentVersion: 1 } })
    }
    assert.equal(cctvError(new Error('database secret')).body.error.includes('secret'), false)
  } finally { await env.close() }
})
