const test = require('node:test')
const assert = require('node:assert/strict')
test('monthly rotation excludes occasional technical profiles and inactive technicians', async () => {
  const { monthlyEligibleTechnicians, monthlyTeamRotation } = await import('../src/domain/agenda/monthly-team-rotation.mjs')
  const regular = ['Rodrigo Gonzalez', 'Pascual Gonzalez', 'Mariano Diaz Tillard', 'Santos Diaz', 'Leonardo Rivadero'].map((name, id) => ({ id, name, status: 'Activo', roleCode: 'technician' }))
  const eligible = monthlyEligibleTechnicians([...regular, { id: 6, name: 'Gonzalo Rivadero', status: 'Activo', roleCode: 'user', technicalEnabled: true }, { id: 7, status: 'Inactivo', roleCode: 'technician' }])
  assert.deepEqual(eligible, regular)
  assert.deepEqual(monthlyTeamRotation(eligible, '2026-10').map(g => g.map(t => t.name)), [['Pascual Gonzalez', 'Mariano Diaz Tillard'], ['Santos Diaz', 'Leonardo Rivadero'], ['Rodrigo Gonzalez']])
})
