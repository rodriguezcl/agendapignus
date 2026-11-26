const assert = require('node:assert/strict')
const test = require('node:test')

const { databasePoolSize, readExportState, readRevision, readState, readTechnicianState } = require('../api/_lib/database.cjs')

test('permite varias operaciones de base simultáneas con un límite acotado', () => {
  assert.equal(databasePoolSize({}), 6)
  assert.equal(databasePoolSize({ PIGNUS_DB_POOL_MAX: '6' }), 6)
  assert.equal(databasePoolSize({ PIGNUS_DB_POOL_MAX: '1' }), 2)
  assert.equal(databasePoolSize({ PIGNUS_DB_POOL_MAX: '99' }), 10)
})

test('consulta sólo historial, referencias de cuenta y vehículos para refrescar la agenda técnica', async () => {
  const queries = []
  const sql = async (strings, ...values) => {
    queries.push({ statement: strings.join('?'), values })
    return [{
      history: [{ id: 'job-1', technicianIds: ['tech-1'] }],
      preferences: { state_revision: '14', vehicles: JSON.stringify([{ id: 'vehicle-1' }]) }
    }]
  }

  const state = await readTechnicianState(sql, 'tech-1', '2026-09-10')

  assert.equal(queries.length, 1)
  assert.equal(state.revision, 14)
  assert.deepEqual(state.history, [{ id: 'job-1', technicianIds: ['tech-1'] }])
  assert.deepEqual(state.vehicles, [{ id: 'vehicle-1' }])
  assert.match(queries[0].statement, /active_customers/)
  assert.equal((queries[0].statement.match(/jsonb_array_elements_text/g) || []).length, 2)
  assert.doesNotMatch(queries[0].statement, /technicianIds'[^\n]*\?/)
  assert.deepEqual(queries[0].values, ['tech-1', '2026-09-10', 'tech-1'])
  assert.doesNotMatch(queries[0].statement, /jsonb_agg\(c\.data|pignus_employees|pignus_roles|select data from pignus_agendas/)
  assert.equal(state.agenda, null)
})

test('el detalle técnico legacy toma el requerimiento actualizado por ID o código sin descargar el padrón', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
  const { visibleTechnicianStateForUser } = require('../api/_lib/core.cjs')
  const pg = await PGlite.create()
  try {
    await pg.exec(`
      create table pignus_work_history (id text primary key, work_date date, created_at timestamptz default now(), data jsonb);
      create table pignus_customers (customer_id text primary key, account text unique, data jsonb);
      create table pignus_agendas (id text primary key, data jsonb);
      create table pignus_preferences (key text primary key, value text);
      insert into pignus_customers values
        ('one','PIG-1','{"cctvService":true,"cctvRequirement":"Otro","private":"oculto"}'),
        ('two','CLI-2','{"cctvService":false,"cctvRequirement":"Otro"}'),
        ('other','CLI-3','{"cctvService":true,"cctvRequirement":"Otro"}');
      insert into pignus_work_history (id, data) values
        ('a','{"id":"a","customerId":"one","technicianIds":["tech"]}'),
        ('b','{"id":"b","client":"  pig-1  Cliente","technicianIds":["tech"]}'),
        ('c','{"id":"c","clientAccount":"cli-2","technicianIds":["tech"],"customerCctvRequirement":"dato anterior"}'),
        ('d','{"id":"d","customerId":"other","technicianIds":["other"]}');
    `)
    const statements = [], sql = pgliteAdapter(pg, statements)
    const snapshot = () => readTechnicianState(sql, 'tech', '2026-11-26')
    const project = state => visibleTechnicianStateForUser(state, { id: 'tech', roleCode: 'technician' })
    const before = await snapshot()
    assert.equal(statements.length, 1)
    assert.deepEqual(before.customers.map(customer => customer.customerId).sort(), ['one', 'two'])
    assert.ok(before.customers.every(customer => !Object.hasOwn(customer, 'private')))
    assert.deepEqual(project(before).history.map(record => record.customerCctvRequirement), ['Otro', 'Otro', ''])
    await pg.exec(`update pignus_customers set data = jsonb_set(data, '{cctvRequirement}', '"Requiere llave de ingreso"') where customer_id = 'one'`)
    const after = project(await snapshot())
    assert.deepEqual(after.customers, [])
    assert.deepEqual(after.history.map(record => record.customerCctvRequirement), ['Requiere llave de ingreso', 'Requiere llave de ingreso', ''])
  } finally {
    await pg.close()
  }
})

test('la consulta técnica de un rol anterior respeta el modelo de almacenamiento activo', async () => {
  const { readApplicationTechnicianState } = require('../api/_lib/storage-router.cjs')
  for (const model of ['legacy', 'normalized']) {
    const sql = async strings => {
      assert.equal(model, 'legacy')
      assert.match(strings.join('?'), /related_history/)
      return [{ related_customers: [{ customerId: 'legacy' }], preferences: { state_revision: '4' } }]
    }
    sql.query = async statement => {
      if (statement.includes('as import_batch')) return [{ import_batch: 'import_batch' }]
      if (statement.startsWith('select id from')) return [{ id: 1 }]
      if (statement.startsWith('select active_model')) return [{ active_model: model, active_revision: 4 }]
      if (statement.includes('as batch_table')) return [{ batch_table: 'batch', control_table: 'control' }]
      assert.equal(model, 'normalized', 'el almacenamiento anterior debe conservar su consulta acotada')
      assert.match(statement, /normalized_shadow\.source_record_evidence/)
      return [{ revision: 4, storage_control: { model, revision: 4 }, evidence: [{ collection: 'customers', original_payload: { customerId: model } }] }]
    }
    const snapshot = await readApplicationTechnicianState(sql, 'tech', '2026-11-26')
    assert.deepEqual(snapshot.customers, [{ customerId: model }])
    assert.equal(snapshot.revision, 4)
  }
})

test('la lectura móvil legacy transmite la pausa a la proyección técnica y libera la agenda siguiente', async () => {
  const { visibleStateForUser, visibleTechnicianStateForUser } = require('../api/_lib/core.cjs')
  const user = { id: 'tech-1', roleCode: 'technician' }
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const oldControl = { id: 'control', date: '2020-01-01', status: 'Pendiente', vehicleControl: true, technicianIds: ['tech-1'] }
  const history = [oldControl, { ...oldControl, id: 'completed-control', status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Informe conservado' }, { id: 'today', date: today, status: 'Pendiente', technicianIds: ['tech-1'] }]
  for (const vehicle_controls of [{ paused: true }, { paused: false }, null]) {
    let queries = 0
    const sql = async strings => {
      queries++
      assert.ok(strings.join('').includes("data->'weekly'->'_vehicleControls'"), 'La consulta debe obtener el indicador de pausa')
      return [{ history, vehicle_controls, preferences: { state_revision: '15' } }]
    }
    const state = await readTechnicianState(sql, user.id, today)
    assert.equal(queries, 1)
    assert.deepEqual(state.agenda, vehicle_controls ? { weekly: { _vehicleControls: vehicle_controls } } : null)
    for (const project of [visibleStateForUser, visibleTechnicianStateForUser]) {
      const result = project(state, user)
      assert.equal(result.history.some(record => record.id === 'control'), vehicle_controls?.paused !== true)
      assert.equal(result.history.some(record => record.id === 'today'), vehicle_controls?.paused === true)
      assert.equal(result.history.find(record => record.id === 'completed-control').technicalObservation, 'Informe conservado')
      assert.deepEqual(result.agenda, state.agenda)
    }
  }
})

test('reconstruye el estado de Supabase en una única consulta agregada', async () => {
  const queries = []
  const sql = async strings => {
    queries.push(strings.join(' '))
    return [{
      roles: [{ id: 'role-1' }],
      employees: [{ id: 'employee-1' }],
      services: [{ id: 'service-1' }],
      customers: [{ account: 'PIG1' }],
      history: [{ id: 'history-1' }],
      agenda: { teams: [] },
      reviews: [],
      preferences: { state_revision: '4', theme: 'dark', vehicles: JSON.stringify([{ id: 'vehicle-1', brand: 'Ford', model: 'Ranger', year: 2026, plate: 'AB123CD' }]) }
    }]
  }

  const state = await readState(sql)

  assert.equal(queries.length, 1)
  assert.equal(state.revision, 4)
  assert.equal(state.customers.length, 1)
  assert.equal(state.history.length, 1)
  assert.deepEqual(state.vehicles, [{ id: 'vehicle-1', brand: 'Ford', model: 'Ranger', year: 2026, plate: 'AB123CD' }])
  assert.deepEqual(state.agenda, { teams: [] })
  assert.equal(state.preferences.theme, 'dark')
})

test('consulta la revisión sin descargar el estado completo', async () => {
  const queries = []
  const sql = async strings => { queries.push(strings.join(' ')); return [{ value: '9' }] }

  assert.equal(await readRevision(sql), 9)
  assert.equal(queries.length, 1)
  assert.match(queries[0], /state_revision/)
  assert.doesNotMatch(queries[0], /pignus_customers|pignus_work_history/)
})

test('consulta solamente servicios e historial para generar exportaciones', async () => {
  const queries = []
  const sql = async strings => {
    queries.push(strings.join(' '))
    return [{ services: [{ id: 'service-1' }], history: [{ id: 'history-1' }] }]
  }

  const state = await readExportState(sql)

  assert.equal(queries.length, 1)
  assert.deepEqual(state.services, [{ id: 'service-1' }])
  assert.deepEqual(state.history, [{ id: 'history-1' }])
  assert.match(queries[0], /pignus_services/)
  assert.match(queries[0], /pignus_work_history/)
  assert.doesNotMatch(queries[0], /pignus_customers|pignus_agendas|pignus_employees|pignus_preferences/)
})
