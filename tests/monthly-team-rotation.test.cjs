const test = require('node:test')
const assert = require('node:assert/strict')

const technicians = [
  { id: 's', name: 'Santos Diaz' },
  { id: 'l', name: 'Leonardo Rivadero' },
  { id: 'p', name: 'Pascual Gonzalez' },
  { id: 'm', name: 'Mariano Diaz Tillard' },
  { id: 'r', name: 'Rodrigo Gonzalez' }
]

test('rota dos duplas y un técnico solo durante un ciclo de cinco meses', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  const ids = month => monthlyTeamRotation(technicians, month).map(team => team.map(technician => technician.id))

  assert.deepEqual(ids('2026-01'), [['r', 'p'], ['m', 's'], ['l']])
  assert.deepEqual(ids('2026-02'), [['r', 'm'], ['p', 'l'], ['s']])
  assert.deepEqual(ids('2026-03'), [['r', 's'], ['m', 'l'], ['p']])
  assert.deepEqual(ids('2026-04'), [['r', 'l'], ['p', 's'], ['m']])
  assert.deepEqual(ids('2026-05'), [['p', 'm'], ['s', 'l'], ['r']])
  assert.deepEqual(ids('2026-06'), ids('2026-01'))
})

test('el ciclo continúa entre años sin reiniciarse en enero', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  assert.deepEqual(
    monthlyTeamRotation(technicians, '2027-01').map(team => team.map(technician => technician.id)),
    monthlyTeamRotation(technicians, '2026-03').map(team => team.map(technician => technician.id))
  )
})

test('no inventa dos duplas y una salida individual si no hay cinco técnicos activos', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  assert.deepEqual(monthlyTeamRotation(technicians.slice(0, 4), '2026-01'), [])
})
