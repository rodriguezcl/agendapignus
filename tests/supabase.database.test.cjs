const assert = require('node:assert/strict')
const test = require('node:test')

const { databasePoolSize, readExportState, readRevision, readState, readTechnicianState } = require('../api/_lib/database.cjs')

test('permite varias operaciones de base simultáneas con un límite acotado', () => {
  assert.equal(databasePoolSize({}), 6)
  assert.equal(databasePoolSize({ PIGNUS_DB_POOL_MAX: '6' }), 6)
  assert.equal(databasePoolSize({ PIGNUS_DB_POOL_MAX: '1' }), 2)
  assert.equal(databasePoolSize({ PIGNUS_DB_POOL_MAX: '99' }), 10)
})

test('consulta sólo historial relacionado y vehículos para refrescar la agenda técnica', async () => {
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
  assert.doesNotMatch(queries[0].statement, /pignus_customers|pignus_employees|pignus_roles|select data from pignus_agendas/)
  assert.equal(state.agenda, null)
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
