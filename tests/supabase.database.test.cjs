const assert = require('node:assert/strict')
const test = require('node:test')

const { readExportState, readRevision, readState } = require('../api/_lib/database.cjs')

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
      preferences: { state_revision: '4', theme: 'dark' }
    }]
  }

  const state = await readState(sql)

  assert.equal(queries.length, 1)
  assert.equal(state.revision, 4)
  assert.equal(state.customers.length, 1)
  assert.equal(state.history.length, 1)
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
