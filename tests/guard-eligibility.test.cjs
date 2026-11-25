const test = require('node:test')
const assert = require('node:assert/strict')
const { guardEligibleFrom, guardEligibleOnDate, isCalendarDate } = require('../api/_lib/guard-eligibility.cjs')
const { guardForDate } = require('../api/_lib/annual-guard-rotation.cjs')

const guard = (technicianId, guardEligibleFrom) => ({ technicianId, name: technicianId.toUpperCase(), ...(guardEligibleFrom ? { guardEligibleFrom } : {}) })
const dates = (first, count) => Array.from({ length: count }, (_, index) => new Date(Date.parse(`${first}T12:00:00Z`) + index * 604800000).toISOString().slice(0, 10))
const assigned = (config, first, count) => dates(first, count).map(date => guardForDate(date, config)?.technicianId || null)

test('cumple 60 días calendario exactos, inclusive con cambio de año y febrero bisiesto', () => {
  assert.equal(guardEligibleFrom({ employmentStartDate: '2026-11-25' }), '2027-01-24')
  assert.equal(guardEligibleFrom({ employmentStartDate: '2028-02-01' }), '2028-04-01')
  assert.equal(guardEligibleFrom({ employmentStartDate: '2027-02-01' }), '2027-04-02')
  const employee = { employmentStartDate: '2026-09-29' }
  assert.equal(guardEligibleFrom(employee), '2026-11-28')
  assert.equal(guardEligibleOnDate(employee, '2026-11-27'), false, 'El adelanto al viernes todavía sería día 59')
  assert.equal(guardEligibleOnDate(employee, '2026-11-28'), true)
})

test('legados sin fecha siguen habilitados; proyecciones operativas usan sólo la habilitación derivada', () => {
  assert.equal(guardEligibleFrom({}), '')
  assert.equal(guardEligibleFrom({ employmentStartDate: '' }), '')
  assert.equal(guardEligibleOnDate({}, '2026-11-28'), true)
  assert.equal(guardEligibleFrom({ guardEligibleFrom: '2027-01-24' }), '2027-01-24')
  assert.equal(guardEligibleOnDate({ guardEligibleFrom: '2027-01-24' }, '2027-01-23'), false)
  assert.equal(guardEligibleOnDate({ guardEligibleFrom: '2027-01-24' }, '2027-01-30'), true)
  assert.equal(guardEligibleFrom({ employmentStartDate: '2026-11-25', guardEligibleFrom: '2026-11-25' }), '2027-01-24', 'La fecha canónica tiene prioridad sobre un dato derivado viejo')
})

test('fechas inválidas no se normalizan a otro día ni habilitan una guardia', () => {
  for (const value of ['2026-02-29', '2026-13-01', '25/11/2026', '2026-1-02', 'no-date']) {
    assert.equal(isCalendarDate(value), false)
    assert.throws(() => guardEligibleFrom({ employmentStartDate: value }), TypeError)
    assert.equal(guardEligibleOnDate({ guardEligibleFrom: value }, '2026-11-28'), false)
  }
  assert.equal(isCalendarDate('2028-02-29'), true)
  assert.equal(guardEligibleOnDate({}, '2026-02-29'), false)
})

test('el nuevo habilitado entra en su próximo turno sin reiniciar ni saltar el orden de los demás', () => {
  const config = { startDate: '2026-01-03', rotation: [guard('a'), guard('b'), guard('c'), guard('new', '2026-01-31')] }
  assert.deepEqual(assigned(config, '2026-01-03', 10), ['a', 'b', 'c', 'a', 'b', 'c', 'new', 'a', 'b', 'c'])
  assert.equal(guardForDate('2026-01-31', config).technicianId, 'b', 'Cambiar el largo del módulo repetiría A inmediatamente después del 24/1')
})

test('el plazo que cruza al año siguiente no deja huecos y se cumple sin guardar otra vez', () => {
  const config = { effectiveFrom: '2026-11-28', startDate: '2026-11-28', rotation: [guard('a'), guard('b'), guard('c'), guard('new', guardEligibleFrom({ employmentStartDate: '2026-11-25' }))] }
  const unchanged = structuredClone(config)
  assert.deepEqual(assigned(config, '2026-11-28', 11), ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'new', 'a'])
  assert.equal(guardForDate('2027-01-23', config).technicianId, 'c')
  assert.equal(guardForDate('2027-01-30', config).technicianId, 'new')
  assert.deepEqual(config, unchanged)
})

test('sin habilitados deja el sábado sin asignación y retoma cuando alguien cumple el plazo', () => {
  const config = { startDate: '2026-01-03', rotation: [guard('a', '2026-01-17'), guard('b', '2026-01-24')] }
  assert.deepEqual(assigned(config, '2026-01-03', 6), [null, null, 'a', 'b', 'a', 'b'])
})

test('las versiones anteriores conservan su composición y secuencia histórica', () => {
  const old = { effectiveFrom: '2026-01-01', startDate: '2026-01-03', rotation: [guard('a'), guard('b'), guard('c')] }
  const config = { effectiveFrom: '2026-01-31', startDate: '2026-01-31', rotation: [guard('b'), guard('c'), guard('new', '2026-02-14'), guard('a')], previousRotations: [old] }
  for (const date of dates('2026-01-03', 4)) assert.deepEqual(guardForDate(date, config), guardForDate(date, old))
  assert.deepEqual(assigned(config, '2026-01-31', 5), ['b', 'c', 'new', 'a', 'b'])
  assert.equal(guardForDate('2026-02-15', config), null)
})

test('las rotaciones sin restricciones conservan exactamente el módulo legado', () => {
  const rotation = [guard('a'), guard('b'), guard('c')], config = { startDate: '2026-03-14', rotation }
  for (const date of dates('2026-01-03', 52)) {
    const weeks = Math.round((Date.parse(date) - Date.parse(config.startDate)) / 604800000)
    assert.equal(guardForDate(date, config), rotation[((weeks % rotation.length) + rotation.length) % rotation.length])
  }
})
