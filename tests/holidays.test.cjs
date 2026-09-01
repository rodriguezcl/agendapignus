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

test('el respaldo local 2026 incluye feriados móviles y puentes oficiales', () => {
  const { localHolidayFallback } = require('../api/_lib/holidays.cjs')
  const holidays = localHolidayFallback(2026)
  assert.ok(holidays.some(record => record.date === '2026-02-16' && record.name === 'Carnaval'))
  assert.ok(holidays.some(record => record.date === '2026-04-03' && record.name === 'Viernes Santo'))
  assert.ok(holidays.some(record => record.date === '2026-07-10' && record.type === 'puente'))
  assert.ok(holidays.every(record => record.source === 'Respaldo legal local'))
})

test('la agenda recibe el respaldo local cuando fallan todos los proveedores externos', async () => {
  const { fetchNationalHolidays } = require('../api/_lib/holidays.cjs')
  const failingFetch = async () => { throw new Error('Proveedor no disponible') }
  const holidays = await fetchNationalHolidays(2027, failingFetch)
  assert.ok(holidays.length >= 16)
  assert.ok(holidays.some(record => record.date === '2027-01-01'))
  assert.ok(holidays.some(record => record.name === 'Viernes Santo'))
})

test('la consulta usa la primera fuente de feriados disponible sin esperar a la más lenta', async () => {
  const { firstAvailableHolidayRecords } = require('../api/_lib/holidays.cjs')
  const startedAt = Date.now()
  const records = await firstAvailableHolidayRecords([
    async () => [{ date: '2026-09-01', name: 'Respuesta rápida' }],
    async signal => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve([{ date: '2026-09-02', name: 'Respuesta lenta' }]), 500)
      signal.addEventListener('abort', () => { clearTimeout(timeout); reject(new Error('cancelada')) }, { once: true })
    })
  ])
  assert.equal(records[0].name, 'Respuesta rápida')
  assert.ok(Date.now() - startedAt < 200)
})

test('el navegador reutiliza durante doce horas el calendario ya verificado', async () => {
  const { NATIONAL_HOLIDAY_CACHE_TTL_MS, readNationalHolidayCache, writeNationalHolidayCache } = await import('../src/holidays.mjs')
  const values = new Map()
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  const records = [{ date: '2026-12-25', name: 'Navidad' }]
  assert.equal(writeNationalHolidayCache('2026', records, storage, 1_000), true)
  assert.deepEqual(readNationalHolidayCache(['2026'], storage, 1_000 + NATIONAL_HOLIDAY_CACHE_TTL_MS - 1), { complete: true, records })
  assert.deepEqual(readNationalHolidayCache(['2026'], storage, 1_000 + NATIONAL_HOLIDAY_CACHE_TTL_MS), { complete: false, records: [] })
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

test('Agenda del día no sincroniza ni guarda un feriado no operativo', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  assert.match(source, /if \(advancedGuard \|\| sundayBlocked \|\| holidayBlocked \|\| holidayCalendarUnavailable\) return/)
  assert.match(source, /const registerHistory[\s\S]*?if \(holidayBlocked\)[\s\S]*?return false/)
  assert.match(source, /Agenda del feriado bloqueada/)
  assert.match(source, /fue definido como día no operativo y no admite servicios/)
})

test('la API de feriados exige sesión y dispone de fuente de respaldo', () => {
  const apiSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'api', 'index.js'), 'utf8')
  const holidaySource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'api', '_lib', 'holidays.cjs'), 'utf8')
  assert.match(apiSource, /route === '\/holidays'/)
  assert.ok(apiSource.indexOf('requireSession') < apiSource.indexOf("route === '/holidays'"))
  assert.match(holidaySource, /api\.argentinadatos\.com/)
  assert.match(holidaySource, /nagerholidays\.com\/api\/v4/)
  assert.match(holidaySource, /localHolidayFallback/)
})

test('el servidor conserva configuraciones administrativas frente a escrituras no administrativas', () => {
  const { authorizeIncomingState } = require('../api/_lib/core.cjs')
  const current = {
    roles: [], employees: [], services: [], customers: [], history: [], reviews: [],
    agenda: { date: '2026-12-08', teams: [], weekly: { _holidayOverrides: { '2026-12-08': { status: 'closed' } }, _annualGuards: { 2026: { rotation: [{ technicianId: 'tech-1', name: 'Técnico 1' }], configurationHistory: [{ id: 'guard-change-1' }] } }, _monthlyTeams: { '2026-12': { teams: [], configurationHistory: [{ id: 'team-change-1' }] } } } }
  }
  const incoming = structuredClone(current)
  incoming.agenda.weekly._holidayOverrides['2026-12-08'] = { status: 'working' }
  incoming.agenda.weekly._annualGuards[2026].rotation = []
  incoming.agenda.weekly._annualGuards[2026].configurationHistory = []
  incoming.agenda.weekly._monthlyTeams['2026-12'].configurationHistory = []
  incoming.agenda.weekly['2026-12-09'] = { teams: [] }
  const user = { roleCode: 'coordinator', permissions: { weekly: true } }

  const authorized = authorizeIncomingState(incoming, current, user)
  assert.equal(authorized.agenda.weekly._holidayOverrides['2026-12-08'].status, 'closed')
  assert.equal(authorized.agenda.weekly._annualGuards[2026].rotation[0].technicianId, 'tech-1')
  assert.equal(authorized.agenda.weekly._annualGuards[2026].configurationHistory[0].id, 'guard-change-1')
  assert.equal(authorized.agenda.weekly._monthlyTeams['2026-12'].configurationHistory[0].id, 'team-change-1')
  assert.deepEqual(authorized.agenda.weekly['2026-12-09'], { teams: [] })
})
