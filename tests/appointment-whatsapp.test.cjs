const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const notice = require('../api/_lib/appointment-notice.cjs')
const whatsapp = require('../api/_lib/appointment-whatsapp.cjs')
const mail = require('../api/_lib/appointment-confirmation.cjs')
const instant = Date.parse('2026-10-29T15:00:00Z')
const env = { PIGNUS_SESSION_SECRET: 'test-secret-'.repeat(8), PIGNUS_GHL_ENABLED: 'true', PIGNUS_GHL_WEBHOOK_URL: 'https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/00000000-0000-0000-0000-000000000000' }
const record = { id: 'visit', customerId: 'customer', client: 'Ana Prueba', clientAccount: 'CLI-1', service: 'Instalación de alarma', status: 'Pendiente', date: '2026-11-02', time: '09:00', address: 'Calle de prueba 123', phone: '+5493510000000', formEmail: 'ana@example.com', technicians: ['Técnico Uno', 'Técnico Dos'], awaitingConfirmation: false }
const state = r => ({ history: r ? [r] : [], customers: [{ customerId: 'customer', account: 'CLI-1', name: 'Ana Prueba' }] })
const before = state({ ...record, awaitingConfirmation: true }), after = state(record)
const at = () => new Date(instant).toISOString()
const response = (status = 200, body = '{"status":"Success"}') => new Response(body, { status })
async function fixture() {
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env })
  await store.ensure(); await store.enqueue(before, after, at())
  return { db, store, options: { store, env, now: () => instant, readState: async () => after } }
}

test('confirmed alarm installations, regardless of sales origin, send once; ordinary edits and other services do not', () => {
  assert.equal(notice.changes(before, after).length, 1)
  assert.equal(mail.confirmations(before, after).length, 1)
  assert.equal(notice.changes(after, after).length, 0)
  assert.equal(notice.changes(after, state({ ...record, detail: 'Editado' })).length, 0)
  assert.equal(notice.changes(state({ ...record, awaitingConfirmation: undefined }), after).length, 0)
  for (const patch of [{ awaitingConfirmation: true }, { status: 'Cancelado' }, { status: 'Completado' }, { status: 'Reprogramado' }, { startedAt: '2026-11-02T12:00:00Z' }, { technicalStatus: 'Cancelado' }, { service: 'Service de alarma' }, { vehicleControl: true }]) assert.equal(notice.changes(before, state({ ...record, ...patch })).length, 0)
  assert.equal(mail.confirmations(before, state({ ...record, form: 'Pendiente' })).length, 1)
  assert.match(mail.message(notice.envelope(record, after), record).text, /Técnico Uno \/ Técnico Dos/)
})

test('correct telephone normalization, missing numbers and independent email destination', () => {
  for (const phone of ['+54 9 351 235-2959', '5493512352959', '0351 15-235-2959', '3512352959']) assert.equal(notice.phoneNumber(phone), '+5493512352959')
  for (const phone of ['', '2352959', '3512352959 / 3511111111', 'llamar 3512352959']) assert.equal(notice.phoneNumber(phone), '')
  assert.equal(notice.phoneNumber('+1 (202) 555-0100'), '+12025550100')
  assert.equal(mail.confirmations(before, state({ ...record, formEmail: '' })).length, 0)
  assert.equal(notice.changes(before, state({ ...record, formEmail: '' }), 'whatsapp').length, 1)
})

test('only the first journey visit is notified; a rescheduled date gets a new event', () => {
  const one = { ...record, serviceJourney: { id: 'journey', index: 1 } }, two = { ...record, id: 'visit2', date: '2026-11-03', serviceJourney: { id: 'journey', index: 2 } }
  const next = { ...after, history: [two, one] }
  assert.equal(notice.changes({ history: [] }, next).length, 1)
  assert.equal(notice.changes({ history: [] }, { ...next, history: [{ ...one, status: 'Avance registrado' }, two] }).length, 0)
  const [change] = notice.changes(after, state({ ...record, date: '2026-11-03' }))
  assert.notEqual(change.id, notice.envelope(record, after).id)
})

test('payload is restricted to appointment data, no observations or financial/internal fields', () => {
  const payload = notice.webhookPayload(notice.envelope({ ...record, internalNote: 'secret', amount: 99 }, after))
  assert.deepEqual(Object.keys(payload).sort(), ['event','eventId','isTest','serviceId','firstName','lastName','customerName','email','phone','appointmentDate','appointmentTime','appointmentDateText','address','technicians','serviceType','installationDescription'].sort())
  assert.equal(payload.appointmentTime, '09:00')
  assert.match(payload.appointmentDateText, /lunes.*2.*noviembre.*2026/)
  assert.equal(payload.isTest, false)
})

test('replacement first journey visit updates the queued service reference before dispatch', async () => {
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env })
  const first = { ...record, serviceJourney: { id: 'same-journey', index: 1 } }
  const replacement = { ...first, id: 'replacement' }
  try {
    await store.enqueue(state(null), state(first), at())
    await store.enqueue(state(first), state(replacement), at())
    const rows = await store.list()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].service_id, replacement.id)
    assert.equal((await whatsapp.processWhatsApp({ store, env, now: () => instant, readState: async () => state(replacement), fetchImpl: async () => response() })).accepted, 1)
  } finally { db.close() }
})

test('disabled channel queues nothing and URL restrictions disallow arbitrary hosts and credential leaks', async () => {
  for (const url of ['http://services.leadconnectorhq.com/hooks/a/webhook-trigger/abc', 'https://evil.example/hooks/a/webhook-trigger/abc', `${env.PIGNUS_GHL_WEBHOOK_URL}?secret=foo`, 'https://user:password@services.leadconnectorhq.com/hooks/a/webhook-trigger/abc']) assert.equal(whatsapp.configuration({ ...env, PIGNUS_GHL_WEBHOOK_URL: url }).enabled, false)
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env: { ...env, PIGNUS_GHL_ENABLED: 'false' } })
  try { await store.ensure(); await store.enqueue(before, after, at()); assert.deepEqual(await store.list(), []) } finally { db.close() }
})

test('queue is atomic and idempotent, no retrospective notices or repeat after acceptance', async () => {
  const { db, store, options } = await fixture(); let calls = 0
  try {
    await store.enqueue(before, after, at()); assert.equal((await store.list()).length, 1)
    db.exec('BEGIN'); await store.enqueue(before, state({ ...record, id: 'rollback' }), at()); db.exec('ROLLBACK')
    await store.enqueue(state(null), state({ ...record, id: 'past', date: '2026-10-28' }), at()); assert.equal((await store.list()).length, 1)
    const fetchImpl = async (url, init) => { calls++; assert.equal(url, env.PIGNUS_GHL_WEBHOOK_URL); assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).phone, record.phone); return response() }
    assert.equal((await whatsapp.processWhatsApp({ ...options, fetchImpl })).accepted, 1)
    await store.enqueue(before, after, at()); await whatsapp.processWhatsApp({ ...options, fetchImpl }); assert.equal(calls, 1)
    const [row] = await store.list(); assert.equal(row.status, 'accepted'); assert.equal(row.history.at(-1).action, 'accepted')
  } finally { db.close() }
})

test('worker discards cancelled, rescheduled, started or contact-changed visits before contacting GHL', async () => {
  for (const patch of [{ status: 'Cancelado' }, { awaitingConfirmation: true }, { date: '2026-11-03' }, { time: '10:00' }, { phone: '+5493519999999' }, { formEmail: 'other@example.com' }, { status: 'Completado' }, { customerId: 'someone-else' }]) {
    const { db, store, options } = await fixture()
    try { const result = await whatsapp.processWhatsApp({ ...options, readState: async () => state({ ...record, ...patch }), fetchImpl: async () => { throw Error('must not send') } }); assert.equal(result.cancelled, 1) } finally { db.close() }
  }
})

test('missing phone is recoverable by editing the service; paused channel never sends', async () => {
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env })
  try {
    const missing = state({ ...record, phone: '' })
    await store.enqueue(before, missing, at()); assert.equal((await store.list())[0].status, 'needs_phone')
    await store.enqueue(missing, after, at()); assert.equal((await store.list())[0].status, 'queued')
    assert.equal((await whatsapp.processWhatsApp({ store, env: {}, now: () => instant, readState: async () => after })).paused, true)
    assert.equal((await store.list())[0].status, 'queued')
  } finally { db.close() }
})

test('only explicit throttling retries; timeout, 5xx and draft acknowledgements cannot cause duplicate delivery', async () => {
  for (const [fetchImpl, expected] of [[async () => response(429), 'retry'], [async () => response(401), 'failed'], [async () => response(503), 'uncertain'], [async () => { throw Error(env.PIGNUS_GHL_WEBHOOK_URL) }, 'uncertain'], [async () => response(200, '{"status":"Success: test request received"}'), 'draft']]) {
    const { db, store, options } = await fixture()
    try {
      const result = await whatsapp.processWhatsApp({ ...options, fetchImpl }); assert.equal(result[expected], 1)
      const [row] = await store.list(); assert.equal(row.status, expected); assert(!row.last_error.includes(env.PIGNUS_GHL_WEBHOOK_URL))
      assert.equal(await store.claim(at()), null)
    } finally { db.close() }
  }
})

test('interrupted sending recovers as uncertain without resending', async () => {
  const { db, store } = await fixture()
  try { await store.claim(at()); await store.recover(new Date(instant + 11 * 60000).toISOString()); assert.equal((await store.list())[0].status, 'uncertain'); assert.equal(await store.claim(at()), null) } finally { db.close() }
})

test('PostgreSQL queue rollback, concurrent claim guard and RLS', async () => {
  const { PGlite } = require('@electric-sql/pglite'), pg = new PGlite()
  const sql = { unsafe: async (text, params = []) => (await pg.query(text, params)).rows }, store = whatsapp.createStore({ sql, env })
  try {
    await store.ensure(); await pg.exec('BEGIN'); await store.enqueue(before, after, at()); await pg.exec('ROLLBACK'); assert.equal((await store.list()).length, 0)
    await store.enqueue(before, after, at()); await store.enqueue(before, after, at())
    const claims = await Promise.all([store.claim(at()), store.claim(at())]); assert.equal(claims.filter(Boolean).length, 1)
    await store.finish(claims.find(Boolean), 'accepted', null, at()); assert.equal((await store.list())[0].status, 'accepted')
    await store.enqueue(state(null), state({ ...record, id: 'pg-second' }), at())
    assert.equal(await store.claim(at()), null)
    await store.acknowledge(claims.find(Boolean).id, at())
    assert.equal((await store.claim(at())).service_id, 'pg-second')
    assert.equal((await pg.query(`SELECT relrowsecurity FROM pg_class WHERE relname='${whatsapp.TABLE}'`)).rows[0].relrowsecurity, true)
  } finally { await pg.close() }
})

test('WhatsApp states use existing account permissions and never expose the webhook', async () => {
  const { db, store } = await fixture()
  try {
    const { experienceRequest } = require('../api/_lib/installation-experience-http.cjs')
    const request = (user, query = {}) => experienceRequest({ connection: db, kind: 'db', state: after, user, method: 'GET', query })
    const result = await request({ roleCode: 'administrator', id: 'admin' })
    const item = result.items.find(item => item.channel === 'whatsapp'); assert.equal(item.id, `whatsapp:${(await store.list())[0].id}`)
    assert(!JSON.stringify(result).includes('leadconnectorhq'))
    await assert.rejects(request({ roleCode: 'operator' }), /acceso/)
    const reader = { roleCode: 'custom', permissions: { __catalogV2: true, 'accounts.view': true, 'records.read': true, 'records.contact': true, 'notifications.experience': false } }
    assert.equal((await request(reader, { notices: '1' })).items.length, 0)
    assert.equal((await request({ roleCode: 'administrator' }, { id: item.id })).items.length, 1)
  } finally { db.close() }
})

test('signed receipts finish workflows idempotently, reject tampering and survive an early callback', async () => {
  const { db, store } = await fixture()
  try {
    const payload = whatsapp.signedPayload(notice.envelope(record, after), env)
    await assert.rejects(whatsapp.receiveReceipt({ store, env, input: { ...payload, receiptToken: '0'.repeat(64) } }), { statusCode: 401 })
    await assert.rejects(whatsapp.receiveReceipt({ store, env, input: { ...payload, eventId: 'whatsapp-' + '0'.repeat(64) } }), { statusCode: 401 })
    const claimed = await store.claim(at())
    await whatsapp.receiveReceipt({ store, env, input: { customData: payload }, at: at() })
    await store.finish(claimed, 'accepted', null, at())
    await whatsapp.receiveReceipt({ store, env, input: payload, at: at() })
    const [row] = await store.list()
    assert.equal(row.status, 'processed')
    assert.equal(row.history.filter(entry => entry.action === 'workflow_completed').length, 1)
    assert(!JSON.stringify(whatsapp.present(row)).includes(payload.receiptToken))
  } finally { db.close() }
})

test('same phone or email waits for previous GHL workflow; other contacts proceed', async () => {
  const { db, store } = await fixture()
  try {
    const first = await store.claim(at()); await store.finish(first, 'accepted', null, at())
    const second = { ...record, id: 'second', date: '2026-11-03' }
    const third = { ...record, id: 'third', phone: '+5493511111111', formEmail: 'other@example.com' }
    await store.enqueue(state(null), state(second), at())
    await store.enqueue(state(null), state(third), at())
    const independent = await store.claim(at()); assert.equal(independent.service_id, 'third')
    assert.equal(await store.claim(at()), null)
    await store.recover(new Date(instant + 31 * 60000).toISOString())
    assert.equal((await store.list()).find(row => row.id === first.id).status, 'uncertain')
    assert.equal(await store.claim(at()), null)
    await store.acknowledge(first.id, at())
    assert.equal((await store.claim(at())).service_id, 'second')
  } finally { db.close() }
})

test('cancelled visit no longer leaves a missing-phone notification', async () => {
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env })
  try {
    await store.enqueue(before, state({ ...record, phone: '' }), at())
    await store.reconcile(state({ ...record, phone: '', status: 'Cancelado' }), at())
    assert.equal((await store.list())[0].status, 'cancelled')
  } finally { db.close() }
})

test('manual review requires permissions, explicit verification and current version, and never resends', async () => {
  const { db, store } = await fixture()
  try {
    const row = await store.claim(at()); await store.finish(row, 'uncertain', 'Revisar', at())
    const { experienceRequest } = require('../api/_lib/installation-experience-http.cjs')
    const input = { id: `whatsapp:${row.id}`, updatedAt: at(), action: 'review-whatsapp', verified: true }
    const request = (user, body=input) => experienceRequest({ connection: db, kind: 'db', state: after, user, method: 'POST', input: body })
    await assert.rejects(request({ roleCode: 'operator' }), { statusCode: 403 })
    await assert.rejects(request({ roleCode: 'administrator' }, { ...input, verified: false }), { statusCode: 409 })
    await assert.rejects(request({ roleCode: 'administrator' }, { ...input, updatedAt: 'stale' }), { statusCode: 409 })
    await request({ roleCode: 'administrator', id: 'admin', name: 'Admin Prueba' })
    const [reviewed] = await store.list()
    assert.equal(reviewed.status, 'reviewed'); assert.equal(reviewed.history.at(-1).byId, 'admin')
    assert.equal(await store.claim(at()), null)
  } finally { db.close() }
})

test('legacy appointment mail is preserved if sent, and replaced once if still queued', async () => {
  const { createExperienceStore } = require('../api/_lib/installation-experience-store.cjs')
  for (const legacyStatus of ['sent', 'queued']) {
    const db = new DatabaseSync(':memory:'), store = createExperienceStore({ db })
    try {
      await store.ensure()
      const payload = notice.envelope(record, after), legacyId = notice.hash('appointment:visit')
      await store.query(`INSERT INTO pignus_installation_experience_mail (id,service_id,customer_id,status,payload,created_at,updated_at,next_attempt_at,history) VALUES (?,?,?,?,?,?,?,?,?)`, [legacyId, record.id, record.customerId, legacyStatus, JSON.stringify(payload), at(), at(), at(), '[]'])
      await store.enqueue(before, after, at()); await store.enqueue(before, after, at())
      const rows = await store.list()
      assert.equal(rows.filter(item => item.status === 'queued').length, legacyStatus === 'sent' ? 0 : 1)
      assert.equal(rows.filter(item => item.status === 'sent').length, legacyStatus === 'sent' ? 1 : 0)
    } finally { db.close() }
  }
})
