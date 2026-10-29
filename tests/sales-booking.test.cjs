const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const sales = require('../api/_lib/sales-booking.cjs')
const native = require('../api/_lib/native-registration.cjs')
const mail = require('../api/_lib/appointment-confirmation.cjs')
const { createExperienceStore } = require('../api/_lib/installation-experience-store.cjs')
process.env.PIGNUS_REGISTRATION_ENCRYPTION_KEY = 'sales-test-encryption-key-long-enough-not-production'
const actor = { id: 'seller', name: 'Vendedor Prueba', roleCode: 'custom', permissions: { __catalogV2: true, 'sales.view': true, 'sales.reserve': true } }
const point = [-31.4167, -64.1833]
const stateFor = date => ({ customers: [], employees: [{ id: 'tech', status: 'Activo' }, { id: 'second', status: 'Activo' }], services: [{ id: 'install', name: 'Instalación de alarma', status: 'Activo' }], history: [], agenda: { date, teams: [], weekly: { _monthlyTeams: { [date.slice(0, 7)]: { teams: [{ teamId: 'one', label: 'Equipo 1', memberIds: ['tech'], members: ['Técnico Prueba'] }] } } } } })
const inputFor = date => ({ date, estimatedMinutes: 60, coordinates: point, locationConfirmed: true, client: 'Cliente Prueba', phone: '3511234567', address: 'Calle Prueba 123', installationZone: 'docta' })
function job(id, date, hour, location, member = 'tech') { return { id, date, time: hour, teamId: 'one', technicianIds: [member], service: 'Service de alarma', status: 'Pendiente', estimatedMinutes: 60, address: 'Dirección anterior', visitLocation: location ? { address: 'Dirección anterior', coordinates: location } : null } }
test('distance estimate is symmetric, configurable, and never invents missing coordinates', () => {
  assert.equal(sales.estimate(null, point), null)
  assert.deepEqual(sales.estimate(point, [-31.5, -64.2]), sales.estimate([-31.5, -64.2], point))
  assert.equal(sales.estimate(point, point).minutes, 15)
  assert.equal(sales.estimate(point, point, { PIGNUS_SALES_BUFFER_MINUTES: '0' }).minutes, 0)
  assert.ok(sales.estimate(point, [-32, -64]).minutes > 60)
})
test('availability respects both travel legs, shared technicians, lunch, calendar, duration and current time', async () => {
  const date = '2026-11-02', state = stateFor(date), options = { now: new Date('2026-11-02T10:00:00Z'), holidays: [] }
  state.history = [job('a', date, '09:00', point), job('b', date, '12:00', point)]
  const available = await sales.availability(state, inputFor(date), options)
  assert.equal(available.slots.some(s => s.time === '10:00'), false)
  assert.equal(available.slots.some(s => s.time === '10:15'), true)
  assert.equal(available.slots.some(s => s.time === '11:00'), false)
  assert.equal(available.slots.some(s => s.time === '13:00'), false)
  assert.equal(available.slots.some(s => s.time === '16:15'), false)
  state.history[0].teamId = 'another-team'
  assert.equal((await sales.availability(state, inputFor(date), options)).slots.some(s => s.time === '09:00'), false)
  state.history[0].visitLocation = null
  assert.equal((await sales.availability(state, inputFor(date), options)).slots.find(s => s.time === '10:15').reviewLocation, true)
  assert.equal((await sales.availability(state, inputFor(date), { ...options, holidays: [{ date }] })).slots.length, 0)
  await assert.rejects(sales.availability(state, { ...inputFor(date), locationConfirmed: false }, options))
  await assert.rejects(sales.availability(state, { ...inputFor(date), estimatedMinutes: 0 }, options))
  assert.equal((await sales.availability(state, inputFor(date), { ...options, now: new Date('2026-11-02T18:15:00Z') })).slots.some(s => s.time <= '15:15'), false)
})
test('removed teams, monthly identities and day membership are respected', async () => {
  const date = '2026-11-02', state = stateFor(date)
  state.agenda.weekly[date] = { removedTeams: [{ teamId: 'one' }] }
  assert.equal((await sales.teamsFor(state, date)).length, 0)
  state.agenda.weekly[date] = { teams: [{ teamId: 'one', label: 'Equipo 1', memberIds: ['replacement'], members: ['Reemplazo'], tasks: [] }] }
  assert.deepEqual((await sales.teamsFor(state, date))[0].memberIds, ['replacement'])
})
test('each technician has a separate travel origin, and long visits include the lunch break', async () => {
  const date = '2026-11-02', state = stateFor(date), options = { now: new Date('2026-11-02T10:00:00Z'), holidays: [] }
  state.agenda.weekly._monthlyTeams['2026-11'].teams[0].memberIds.push('second')
  state.agenda.weekly._monthlyTeams['2026-11'].teams[0].members.push('Segundo')
  state.history = [job('near', date, '09:00', point), { ...job('far', date, '08:30', [-32.5, -64.2], 'second'), teamId: 'separate' }]
  assert.equal((await sales.availability(state, inputFor(date), options)).slots.some(s => s.time === '10:15'), false)
  state.history = []
  const long = (await sales.availability(state, { ...inputFor(date), estimatedMinutes: 360 }, options)).slots.find(s => s.time === '08:30')
  assert.equal(long.end, '15:30')
})
test('PostgreSQL: sales creation and form submission queue the confirmation atomically', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
  const pg = await PGlite.create(), connection = pgliteAdapter(pg)
  const day = new Date(Date.now() + 7 * 86400000)
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1)
  const date = day.toISOString().slice(0, 10)
  await pg.exec('CREATE TABLE fixture (id TEXT PRIMARY KEY,data TEXT NOT NULL)')
  await pg.query('INSERT INTO fixture VALUES ($1,$2)', ['current', JSON.stringify(stateFor(date))])
  const formState = { load: async () => JSON.parse((await pg.query('SELECT data FROM fixture WHERE id=$1 FOR UPDATE', ['current'])).rows[0].data), save: async (_, before, next) => { await pg.query('UPDATE fixture SET data=$1', [JSON.stringify(next)]) } }
  const holidays = require('../api/_lib/holidays.cjs'), original = holidays.fetchNationalHolidays; holidays.fetchNationalHolidays = async () => []
  try {
    const call = input => sales.handle({ connection, kind: 'sql', user: actor, method: 'POST', input, formState })
    const draft = inputFor(date), slot = (await call({ ...draft, action: 'slots' })).slots[0]
    const result = await call({ ...draft, action: 'reserve', teamId: slot.teamId, time: slot.time, requestId: 'postgres-reservation' })
    const state = await formState.load(); state.history[0].awaitingConfirmation = false; await formState.save(null, null, state)
    const token = result.reservation.link.split('#')[1]
    const publicCall = input => native.handle({ connection, kind: 'sql', publicRequest: true, method: 'POST', input: { ...input, token }, formState })
    const form = await publicCall({ action: 'read' })
    assert.equal(form.appointment.awaitingConfirmation, false)
    await publicCall({ action: 'submit', version: 0, termsVersion: form.termsVersion, values: { name: 'Cliente Prueba', document: '30123456', email: 'cliente@example.com', phone: '3511234567', block: '15', lot: '12', side: 'Lado Córdoba', propertyType: 'Residencial', subscriberPassword: 'palabra-abonado', operatorPassword: 'palabra-operador', contact1: 'Contacto prueba', contactPhone1: '3517654321', guardAccepted: true, termsAccepted: true, declarationAccepted: true } })
    const rows = await createExperienceStore({ sql: connection }).list()
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'queued'); assert.equal(rows[0].payload.kind, 'appointment')
    assert.equal((await formState.load()).history[0].form, 'Completo')
    const store = createExperienceStore({ sql: connection })
    const { processExperienceMail } = require('../api/_lib/installation-experience-worker.cjs')
    const sent = []
    const worker = () => processExperienceMail({ store, readState: formState.load, config: { enabled: true, mode: 'live', address: 'pignus@example.com' }, smtpFactory: () => ({ send: async item => { sent.push(item); return { accepted: ['cliente@example.com'] } } }) })
    await worker(); await worker(); assert.equal(sent.length, 1); assert.ok(sent[0].payload.subject.includes('visita técnica'))
  } finally { holidays.fetchNationalHolidays = original; await pg.close() }
})
test('reserve transaction creates one pending service and private link, retries are idempotent and occupied slots reject', async () => {
  const now = new Date(), future = new Date(now.getTime() + 7 * 86400000)
  while ([0, 6].includes(future.getUTCDay())) future.setUTCDate(future.getUTCDate() + 1)
  const date = future.toISOString().slice(0, 10), db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE fixture (data TEXT)'); db.prepare('INSERT INTO fixture VALUES (?)').run(JSON.stringify(stateFor(date)))
  const formState = { load: async () => JSON.parse(db.prepare('SELECT data FROM fixture').get().data), save: async (_, before, next) => { db.prepare('UPDATE fixture SET data=?').run(JSON.stringify(next)) } }
  // Do not use external holiday APIs during tests.
  const holidays = require('../api/_lib/holidays.cjs'), original = holidays.fetchNationalHolidays
  holidays.fetchNationalHolidays = async () => []
  try {
    const call = (input, user = actor, method = 'POST') => sales.handle({ connection: db, kind: 'db', user, method, input, formState })
    const draft = inputFor(date), slot = (await call({ ...draft, action: 'slots' })).slots[0]
    const command = { ...draft, action: 'reserve', teamId: slot.teamId, time: slot.time, requestId: 'test-reservation-one' }
    const [first, retry] = await Promise.all([call(command), call(command)])
    assert.equal(first.reservation.id, retry.reservation.id)
    assert.ok(first.reservation.link.startsWith('/alta#'))
    const state = await formState.load()
    assert.equal(state.history.length, 1); assert.equal(state.history[0].awaitingConfirmation, true)
    assert.equal(state.agenda.weekly[date].teams[0].tasks.length, 1)
    assert.equal(state.agenda.teams[0].tasks[0].historyId, first.reservation.id)
    assert.deepEqual((await call({}, { ...actor, id: 'another-seller' }, 'GET')).items, [])
    await assert.rejects(call(command, { id: 'denied', roleCode: 'operator' }), e => e.statusCode === 403)
    await assert.rejects(call({ ...command, requestId: 'test-reservation-two' }), e => e.statusCode === 409)
    const read = await native.handle({ connection: db, kind: 'db', publicRequest: true, method: 'POST', input: { action: 'read', token: first.reservation.link.split('#')[1] }, formState })
    assert.equal(read.appointment.awaitingConfirmation, true)
    assert.equal(read.kind, 'docta')
    assert.equal(JSON.stringify(first).includes('technicianIds'), false)
  } finally { holidays.fetchNationalHolidays = original; db.close() }
})
test('appointment email waits for both conditions, independent of order, deduplicates and remains separate from PIG linkage', async () => {
  const record = { id: 's', salesBooking: { byId: 'seller' }, status: 'Pendiente', service: 'Instalación de alarma', awaitingConfirmation: true, form: 'Pendiente', date: '2026-11-02', time: '08:30', client: 'Prueba', address: 'Calle 123' }
  const state = r => ({ history: [r], customers: [] })
  const complete = { ...record, form: 'Completo', formEmail: 'cliente@example.com' }, confirmed = { ...record, awaitingConfirmation: false }, both = { ...complete, awaitingConfirmation: false }
  assert.equal(mail.confirmations(state(record), state(complete)).length, 0)
  assert.equal(mail.confirmations(state(record), state(confirmed)).length, 0)
  assert.equal(mail.confirmations(state(complete), state(both)).length, 1)
  assert.equal(mail.confirmations(state(confirmed), state(both)).length, 1)
  assert.equal(mail.confirmations(state(both), state(both)).length, 0)
  assert.equal(require('../api/_lib/registration-confirmation.cjs').confirmations(state(confirmed), state(both)).length, 0)
  const db = new DatabaseSync(':memory:'), store = createExperienceStore({ db })
  await store.enqueue(state(complete), state(both)); await store.enqueue(state(confirmed), state(both))
  const rows = await store.list(); assert.equal(rows.length, 1); assert.equal(rows[0].payload.kind, 'appointment')
  assert.equal(mail.eligible({ ...both, status: 'Cancelado' }, rows[0].payload), false)
  assert.equal(mail.eligible({ ...both, awaitingConfirmation: true }, rows[0].payload), false)
  const message = mail.message(rows[0].payload, both)
  assert.ok(message.text.includes('Calle 123')); assert.ok(message.subject.includes('confirmada'))
  db.close()
})
