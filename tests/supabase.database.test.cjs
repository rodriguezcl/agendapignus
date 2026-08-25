const assert = require('node:assert/strict')
const test = require('node:test')

const { readState } = require('../api/_lib/database.cjs')

test('lee el estado de Supabase secuencialmente para el Transaction Pooler', async () => {
  let activeQueries = 0
  let maximumConcurrency = 0
  const queries = []

  const sql = async strings => {
    const query = strings.join(' ')
    queries.push(query)
    activeQueries += 1
    maximumConcurrency = Math.max(maximumConcurrency, activeQueries)
    await new Promise(resolve => setImmediate(resolve))
    activeQueries -= 1

    if (query.includes('pignus_roles')) return [{ data: { id: 'role-1' } }]
    if (query.includes('pignus_employees')) return [{ data: { id: 'employee-1' } }]
    if (query.includes('pignus_services')) return [{ data: { id: 'service-1' } }]
    if (query.includes('pignus_customers')) return [{ data: { account: 'PIG1' } }]
    if (query.includes('pignus_work_history')) return [{ data: { id: 'history-1' } }]
    if (query.includes('pignus_agendas')) return [{ id: 'current', data: { teams: [] } }]
    if (query.includes('pignus_reviews')) return []
    if (query.includes('pignus_preferences')) return [
      { key: 'state_revision', value: '4' },
      { key: 'theme', value: 'dark' }
    ]
    throw new Error(`Consulta inesperada: ${query}`)
  }

  const state = await readState(sql)

  assert.equal(queries.length, 8)
  assert.equal(maximumConcurrency, 1)
  assert.equal(state.revision, 4)
  assert.equal(state.customers.length, 1)
  assert.equal(state.history.length, 1)
  assert.deepEqual(state.agenda, { teams: [] })
  assert.equal(state.preferences.theme, 'dark')
})
