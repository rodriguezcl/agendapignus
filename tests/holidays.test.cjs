const test = require('node:test')
const assert = require('node:assert/strict')

test('normaliza feriados argentinos conservando fecha, motivo y tipo', () => {
  const { normalizeArgentinaData } = require('../api/_lib/holidays.cjs')
  assert.deepEqual(normalizeArgentinaData([
    { fecha: '2026-05-25', nombre: 'Día de la Revolución de Mayo', tipo: 'inamovible' }
  ]), [{ date: '2026-05-25', name: 'Día de la Revolución de Mayo', type: 'inamovible', source: 'ArgentinaDatos' }])
})

test('el respaldo internacional conserva solamente feriados nacionales', () => {
  const { normalizeNagerData } = require('../api/_lib/holidays.cjs')
  assert.deepEqual(normalizeNagerData([
    { date: '2026-07-09', name: 'Independence Day', nationalHoliday: true, holidayTypes: ['Public'] },
    { date: '2026-09-01', name: 'Provincial day', nationalHoliday: false, holidayTypes: ['Observance'] }
  ]), [{ date: '2026-07-09', name: 'Independence Day', type: 'Public', source: 'Nager.Holidays' }])
})

test('un feriado queda bloqueado hasta la decisión administrativa', async () => {
  const { holidayDecisionForDate, holidayForDate, holidayIsBlocked, holidayDecisionLabel } = await import('../src/holidays.mjs')
  const holiday = holidayForDate([{ date: '2026-12-08', name: 'Inmaculada Concepción' }], '2026-12-08')
  assert.equal(holidayIsBlocked(holiday, null), true)
  assert.equal(holidayDecisionLabel(null), 'Definición pendiente')

  const weekly = { _holidayOverrides: { '2026-12-08': { status: 'working' } } }
  const decision = holidayDecisionForDate(weekly, '2026-12-08')
  assert.equal(holidayIsBlocked(holiday, decision), false)
  assert.equal(holidayDecisionLabel(decision), 'Día laboral habilitado')
})

test('la API de feriados exige sesión y dispone de fuente de respaldo', () => {
  const apiSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'api', 'index.js'), 'utf8')
  const holidaySource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'api', '_lib', 'holidays.cjs'), 'utf8')
  assert.match(apiSource, /route === '\/holidays'/)
  assert.ok(apiSource.indexOf('requireSession') < apiSource.indexOf("route === '/holidays'"))
  assert.match(holidaySource, /api\.argentinadatos\.com/)
  assert.match(holidaySource, /nagerholidays\.com\/api\/v4/)
})

test('el servidor conserva configuraciones administrativas frente a escrituras no administrativas', () => {
  const { authorizeIncomingState } = require('../api/_lib/core.cjs')
  const current = {
    roles: [], employees: [], services: [], customers: [], history: [], reviews: [],
    agenda: { date: '2026-12-08', teams: [], weekly: { _holidayOverrides: { '2026-12-08': { status: 'closed' } }, _annualGuards: { 2026: { rotation: [{ technicianId: 'tech-1', name: 'Técnico 1' }] } } } }
  }
  const incoming = structuredClone(current)
  incoming.agenda.weekly._holidayOverrides['2026-12-08'] = { status: 'working' }
  incoming.agenda.weekly._annualGuards[2026].rotation = []
  incoming.agenda.weekly['2026-12-09'] = { teams: [] }
  const user = { roleCode: 'coordinator', permissions: { weekly: true } }

  const authorized = authorizeIncomingState(incoming, current, user)
  assert.equal(authorized.agenda.weekly._holidayOverrides['2026-12-08'].status, 'closed')
  assert.equal(authorized.agenda.weekly._annualGuards[2026].rotation[0].technicianId, 'tech-1')
  assert.deepEqual(authorized.agenda.weekly['2026-12-09'], { teams: [] })
})
