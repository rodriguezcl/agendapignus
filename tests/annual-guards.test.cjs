const test = require('node:test')
const assert = require('node:assert/strict')

const rotation = [
  { technicianId: 'rodrigo', name: 'Rodrigo Gonzalez' },
  { technicianId: 'pascual', name: 'Pascual Gonzalez' },
  { technicianId: 'santos', name: 'Santos Diaz' },
  { technicianId: 'mariano', name: 'Mariano Diaz Tillard' },
  { technicianId: 'leonardo', name: 'Leonardo Rivadero' }
]

test('replica durante 2026 el orden de guardias entregado por Administración', async () => {
  const { annualGuardForDate, firstSaturdayOfYear } = await import('../src/annual-guards.mjs')
  const weekly = { _annualGuards: { 2026: { startDate: firstSaturdayOfYear(2026), rotation } } }

  assert.equal(firstSaturdayOfYear(2026), '2026-01-03')
  assert.equal(annualGuardForDate('2026-03-14', weekly).technicianId, 'rodrigo')
  assert.equal(annualGuardForDate('2026-03-21', weekly).technicianId, 'pascual')
  assert.equal(annualGuardForDate('2026-03-28', weekly).technicianId, 'santos')
  assert.equal(annualGuardForDate('2026-04-04', weekly).technicianId, 'mariano')
  assert.equal(annualGuardForDate('2026-04-11', weekly).technicianId, 'leonardo')
  assert.equal(annualGuardForDate('2026-08-29', weekly).technicianId, 'leonardo')
  assert.equal(annualGuardForDate('2026-09-05', weekly).technicianId, 'rodrigo')
  assert.equal(annualGuardForDate('2026-12-26', weekly).technicianId, 'pascual')
})

test('la configuración anual admite otro orden y no asigna días que no sean sábado', async () => {
  const { annualGuardForDate } = await import('../src/annual-guards.mjs')
  const weekly = { _annualGuards: { 2027: { startDate: '2027-01-02', rotation: [rotation[2], rotation[0]] } } }

  assert.equal(annualGuardForDate('2027-01-02', weekly).technicianId, 'santos')
  assert.equal(annualGuardForDate('2027-01-09', weekly).technicianId, 'rodrigo')
  assert.equal(annualGuardForDate('2027-01-04', weekly), null)
})
