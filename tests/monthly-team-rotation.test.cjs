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

test('adapta la cantidad de equipos cuando cambia la dotación', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  const groups = monthlyTeamRotation(technicians.slice(0, 4), '2026-01', '2026-01', 3)
  assert.deepEqual(groups.map(group => group.length).sort(), [1, 1, 2])
  assert.deepEqual(new Set(groups.flat().map(technician => technician.id)).size, 4)
})

test('seis técnicos y cuatro vehículos forman dos duplas y dos salidas individuales rotativas', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  const expanded = [...technicians, { id: 'n', name: 'Nuevo Técnico' }]
  const soloCounts = new Map(expanded.map(technician => [technician.id, 0]))
  const pairings = new Set()
  for (let month = 1; month <= 6; month += 1) {
    const groups = monthlyTeamRotation(expanded, `2026-${String(month).padStart(2, '0')}`, '2026-01', 4)
    assert.deepEqual(groups.map(group => group.length).sort(), [1, 1, 2, 2])
    assert.equal(new Set(groups.flat().map(technician => technician.id)).size, 6)
    groups.filter(group => group.length === 1).forEach(group => soloCounts.set(group[0].id, soloCounts.get(group[0].id) + 1))
    groups.filter(group => group.length === 2).forEach(group => pairings.add(group.map(technician => technician.id).sort().join(':')))
  }
  assert.deepEqual([...soloCounts.values()], [2, 2, 2, 2, 2, 2])
  assert.ok(pairings.size >= 8)
})

test('distribuye grupos mayores de forma equilibrada si hay menos vehículos que equipos ideales', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  const expanded = [...technicians, { id: 'n1', name: 'Nuevo Uno' }, { id: 'n2', name: 'Nuevo Dos' }]
  const groups = monthlyTeamRotation(expanded, '2026-08', '2026-01', 2)
  assert.deepEqual(groups.map(group => group.length).sort(), [3, 4])
  assert.equal(new Set(groups.flat().map(technician => technician.id)).size, 7)
})
