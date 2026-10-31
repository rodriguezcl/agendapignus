const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const notice = require('../api/_lib/appointment-notice.cjs')
const appointment = require('../api/_lib/appointment-confirmation.cjs')
const experience = require('../api/_lib/installation-experience.cjs')
const whatsapp = require('../api/_lib/appointment-whatsapp.cjs')
const postSale = require('../api/_lib/experience-whatsapp.cjs')
const communications = require('../api/_lib/installation-communications.cjs')
const { createExperienceStore } = require('../api/_lib/installation-experience-store.cjs')
const { processExperienceMail } = require('../api/_lib/installation-experience-worker.cjs')
const at = '2026-11-02T12:00:00.000Z', now = () => Date.parse(at)
const url = digit => `https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/${digit.repeat(8)}-0000-0000-0000-000000000000`
const env = { PIGNUS_SESSION_SECRET: 'test-secret-'.repeat(8), PIGNUS_GHL_ENABLED: 'true', PIGNUS_GHL_WEBHOOK_URL: url('0'), PIGNUS_GHL_EXPERIENCE_ENABLED: 'true', PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL: url('1'), PIGNUS_GHL_CAMERAS_ENABLED: 'true', PIGNUS_GHL_CAMERAS_WEBHOOK_URL: url('2'), PIGNUS_GHL_CAMERAS_EXPERIENCE_ENABLED: 'true', PIGNUS_GHL_CAMERAS_EXPERIENCE_WEBHOOK_URL: url('3') }
const record = { id: 'camera-visit', customerId: 'customer', client: 'Ana Prueba', service: 'Instalación de cámaras', status: 'Pendiente', date: '2026-11-02', time: '09:00', address: 'Calle de prueba 123', phone: '+5493510000000', formEmail: 'ana@example.com', technicians: ['Técnico Uno', 'Técnico Dos'], awaitingConfirmation: false }
const state = (...history) => ({ history, customers: [{ customerId: 'customer', name: 'Ana Prueba', account: 'PIG-1' }] })
const done = { ...record, status: 'Completado' }
const smtpConfig = { enabled: true, mode: 'live', address: 'soporte@example.com' }

test('partial completion invites only for the installation actually performed', () => {
  const types = [{ id: 1, name: 'Instalación de alarma' }, { id: 2, name: 'Instalación de cámaras' }]
  const original = { ...record, serviceTypes: types, serviceId: 1, service: types[0].name }
  for (const completedId of [1, 2]) {
    const next = require('../api/_lib/work-completion.cjs').applyResults(original, { ...original, status: 'Completado' }, types.map(t => ({ id: t.id, status: t.id === completedId ? 'completed' : 'pending' })), { id: 'tech', name: 'Técnico' }, at)
    const invitations = experience.completionInvitations(state(original), state(next))
    assert.equal(invitations.length, 1)
    assert.equal(invitations[0].installationType, completedId === 1 ? 'alarm' : 'cameras')
    assert.equal(postSale.envelope(next, state(next)).installationType, invitations[0].installationType)
  }
})

test('camera confirmations wait for approval; repairs, removals and vehicle controls never trigger installation notices', () => {
  assert.equal(notice.changes(state(), state(record)).length, 1)
  assert.equal(notice.changes(state(), state({ ...record, awaitingConfirmation: true })).length, 0)
  assert.equal(notice.changes(state({ ...record, awaitingConfirmation: true }), state(record)).length, 1)
  assert.equal(notice.changes(state(record), state(record)).length, 0)
  for (const service of ['Service de cámaras', 'Service de alarma', 'Retiro de equipo', 'Reinstalación de alarma']) {
    assert.equal(notice.changes(state(), state({ ...record, service })).length, 0)
    assert.equal(experience.completionInvitations(state({ ...record, service }), state({ ...done, service })).length, 0)
  }
  assert.equal(communications.installation({ ...record, vehicleControl: {} }), false)
  assert.equal(require('../api/_lib/alarm-zones.cjs').installation(record), false)
})

test('camera and mixed messages carry correct wording, technicians and clickable review link without duplicate invitations', () => {
  for (const mixed of [false, true]) {
    const service = mixed ? { ...record, serviceTypes: [{ name: 'Instalación de alarma' }, { name: 'Instalación de cámaras' }] } : record
    const description = mixed ? 'tu alarma y tu sistema de cámaras' : 'tu sistema de cámaras'
    const items = notice.changes(state(), state(service)); assert.equal(items.length, 1)
    const confirmation = appointment.message(items[0], service)
    assert(confirmation.text.includes(`instalar ${description}`)); assert(confirmation.text.includes('Técnico Uno / Técnico Dos'))
    const completed = { ...service, status: 'Completado' }
    const invitations = experience.completionInvitations(state(service), state(completed)); assert.equal(invitations.length, 1)
    const mail = experience.message(invitations[0]); assert(mail.text.includes(`instalación de ${description}`))
    assert(mail.html.includes(`href="${experience.REVIEW_URL}"`)); assert(mail.text.includes('Técnico Uno y Técnico Dos'))
    assert.equal(postSale.webhookPayload(postSale.envelope(completed, state(completed))).installationDescription, description)
    assert.equal(notice.webhookPayload(items[0]).installationDescription, description)
    assert.equal(experience.completionInvitations(state(completed), state(completed)).length, 0)
    assert.equal(experience.completionInvitations(state(), state(completed)).length, 0)
  }
})

test('several camera workdays confirm only the first and invite once at final completion', () => {
  const first = { ...record, id: 'day-1', serviceJourney: { id: 'journey', index: 1, total: 2 }, technicians: ['Uno'] }
  const second = { ...record, id: 'day-2', date: '2026-11-03', serviceJourney: { id: 'journey', index: 2, total: 2 }, technicians: ['Dos'] }
  assert.equal(notice.changes(state(), state(first, second)).length, 1)
  const progress = { ...first, status: 'Avance registrado' }
  assert.equal(experience.completionInvitations(state(first, second), state(progress, second)).length, 0)
  const completed = { ...second, status: 'Completado' }
  const items = experience.completionInvitations(state(progress, second), state(progress, completed))
  assert.equal(items.length, 1); assert.deepEqual(items[0].technicians, ['Uno', 'Dos'])
})

test('camera WhatsApp needs its own configured workflow and never falls back to alarm workflows', () => {
  const modernUrl = 'https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/TestMixedCase12345678'
  assert.equal(whatsapp.configuration({ ...env, PIGNUS_GHL_CAMERAS_WEBHOOK_URL: modernUrl }, 'appointment', 'cameras').enabled, true)
  for (const invalid of [modernUrl + '?redirect=1', modernUrl + '/extra', modernUrl.replace('services.leadconnectorhq.com', 'example.com'), modernUrl.replace('https:', 'http:')]) {
    assert.equal(whatsapp.configuration({ ...env, PIGNUS_GHL_CAMERAS_WEBHOOK_URL: invalid }, 'appointment', 'cameras').enabled, false)
  }
  for (const kind of ['appointment', 'experience']) {
    assert.equal(whatsapp.configuration(env, kind, 'cameras').enabled, true)
    assert.equal(whatsapp.configuration(env, kind, 'combined').enabled, true)
    const prefix = kind === 'experience' ? 'PIGNUS_GHL_CAMERAS_EXPERIENCE' : 'PIGNUS_GHL_CAMERAS'
    for (const invalid of ['', env.PIGNUS_GHL_WEBHOOK_URL, env.PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL, env[kind === 'experience' ? 'PIGNUS_GHL_CAMERAS_WEBHOOK_URL' : 'PIGNUS_GHL_CAMERAS_EXPERIENCE_WEBHOOK_URL'], 'https://invalid.example/hook']) {
      assert.equal(whatsapp.configuration({ ...env, [`${prefix}_WEBHOOK_URL`]: invalid }, kind, 'cameras').enabled, false)
    }
  }
  assert.equal(whatsapp.anyEnabled({ ...env, PIGNUS_GHL_ENABLED: 'false', PIGNUS_GHL_EXPERIENCE_ENABLED: 'false' }), true)
})

for (const engine of ['sqlite', 'postgres']) test(`${engine}: camera queues are transactional, route independently and retain disabled routes`, async () => {
  let db, pg, options
  if (engine === 'sqlite') { db = new DatabaseSync(':memory:'); options = { db } }
  else { const { PGlite } = require('@electric-sql/pglite'); pg = new PGlite(); options = { sql: { unsafe: async (text, params = []) => (await pg.query(text, params)).rows } } }
  const exec = text => db ? db.exec(text) : pg.exec(text)
  const store = whatsapp.createStore({ ...options, env })
  try {
    await store.ensure(); await exec('BEGIN'); await store.enqueue(state(), state(record), at); await exec('ROLLBACK'); assert.equal((await store.list()).length, 0)
    await store.enqueue(state(), state(record), at); await store.enqueue(state(), state(record), at)
    assert.equal((await store.list()).length, 1)
    const alarm = { ...record, id: 'alarm', service: 'Instalación de alarma', phone: '+5493511111111', formEmail: 'otro@example.com' }
    await store.enqueue(state(), state(alarm), at)
    let current = state(record, alarm), calls = []
    const run = runtime => whatsapp.processWhatsApp({ store, env: runtime, now, readState: async () => current, fetchImpl: async (endpoint, init) => { calls.push({ endpoint, payload: JSON.parse(init.body) }); return new Response('{}', { status: 200 }) } })
    const paused = { ...env, PIGNUS_GHL_CAMERAS_ENABLED: 'false', PIGNUS_GHL_CAMERAS_EXPERIENCE_ENABLED: 'false' }
    assert.equal((await run(paused)).accepted, 1)
    assert.equal(calls[0].endpoint, env.PIGNUS_GHL_WEBHOOK_URL)
    assert.equal((await store.list()).find(row => row.service_id === record.id).status, 'queued')
    assert.equal((await run(env)).accepted, 1); assert.equal(calls[1].endpoint, env.PIGNUS_GHL_CAMERAS_WEBHOOK_URL)
    assert.equal(calls[1].payload.installationDescription, 'tu sistema de cámaras')
    await whatsapp.receiveReceipt({ store, env, input: calls[1].payload, at })
    current = state(done, alarm)
    await store.enqueue(state(record), state(done), at)
    assert.equal((await run(env)).accepted, 1); assert.equal(calls[2].endpoint, env.PIGNUS_GHL_CAMERAS_EXPERIENCE_WEBHOOK_URL)
    assert.equal(calls[2].payload.reviewUrl, experience.REVIEW_URL)
    await store.enqueue(state(record), state(done), at); assert.equal((await run(env)).accepted, 0); assert.equal(calls.length, 3)
  } finally { db?.close(); await pg?.close() }
})

test('email confirmations and post-sale send for cameras even with WhatsApp disabled; no duplicate delivery', async () => {
  const db = new DatabaseSync(':memory:'), store = createExperienceStore({ db }), sent = []
  const smtpFactory = () => ({ send: async item => { sent.push(item.payload); return { accepted: [item.payload.to] } } })
  try {
    await store.enqueue(state(), state(record), at)
    assert.equal((await processExperienceMail({ store, config: smtpConfig, readState: async () => state(record), now, smtpFactory })).sent, 1)
    assert(sent[0].text.includes('instalar tu sistema de cámaras'))
    await store.enqueue(state(record), state(done), at)
    assert.equal((await processExperienceMail({ store, config: smtpConfig, readState: async () => state(done), now, smtpFactory })).sent, 1)
    assert(sent[1].text.includes('uso de las cámaras'))
    await store.enqueue(state(record), state(done), at)
    assert.equal((await processExperienceMail({ store, config: smtpConfig, readState: async () => state(done), now, smtpFactory })).sent, 0)
  } finally { db.close() }
})

test('queued camera post-sale is cancelled if reopened; reclassified unsent notices use current installation type', async () => {
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env })
  try {
    await store.enqueue(state(record), state(done), at)
    await store.reconcile(state(record), at); assert.equal((await store.list())[0].status, 'cancelled')
    await store.enqueue(state(record), state(done), at)
    const alarm = { ...done, service: 'Instalación de alarma' }; const calls = []
    await whatsapp.processWhatsApp({ store, env, now, readState: async () => state(alarm), fetchImpl: async (endpoint, init) => { calls.push([endpoint, JSON.parse(init.body)]); return new Response('{}') } })
    assert.equal(calls.length, 1); assert.equal(calls[0][0], env.PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL); assert.equal(calls[0][1].serviceType, 'Instalación de alarma')
  } finally { db.close() }
})

test('mixed visits use the camera workflow once; disabled camera activation does not backfill earlier completions', async () => {
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env }), mixed = { ...done, service: 'Instalación de alarma · Instalación de cámaras' }
  try {
    const disabled = whatsapp.createStore({ db, env: { ...env, PIGNUS_GHL_CAMERAS_EXPERIENCE_ENABLED: 'false' } })
    await store.ensure(); await disabled.enqueue(state(record), state(mixed), at); assert.equal((await store.list()).length, 0)
    await store.enqueue(state(mixed), state(mixed), at); assert.equal((await store.list()).length, 0)
    await store.enqueue(state(record), state(mixed), at)
    let calls = 0
    await whatsapp.processWhatsApp({ store, env, now, readState: async () => state(mixed), fetchImpl: async (endpoint, init) => { calls++; assert.equal(endpoint, env.PIGNUS_GHL_CAMERAS_EXPERIENCE_WEBHOOK_URL); assert.equal(JSON.parse(init.body).installationDescription, 'tu alarma y tu sistema de cámaras'); return new Response('{}') } })
    assert.equal(calls, 1)
  } finally { db.close() }
})
