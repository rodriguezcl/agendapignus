const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { createMailChannelStore, TEST_TTL_MS, connectionOptions } = require('../api/_lib/ticket-mail-channel.cjs')
const { resolveMailEndpoint, normalizeMailHost, isPublicMailAddress } = require('../api/_lib/ticket-mail-network.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

const env = { PIGNUS_SESSION_SECRET: 'clave-de-prueba-separada-32-caracteres-minimo' }
const actor = { id: 'admin', name: 'Administrador' }
const areas = [{ id: 'technical', active: true }]
const base = () => ({ address: 'soporte@example.com', senderName: 'Soporte Agentec', mode: 'test', testSourceConfirmed: true, areaId: 'technical', incoming: { protocol: 'imap', host: 'imap.example.com', port: 993, security: 'tls', user: 'soporte@example.com', folder: 'Pruebas', password: 'clave-entrada-no-exponer' }, outgoing: { protocol: 'smtp', host: 'smtp.example.com', port: 465, security: 'tls', user: 'smtp@example.com', useIncomingCredentials: false, password: 'clave-salida-no-exponer' } })
const endpoint = { host: '8.8.8.8', port: 993, servername: 'imap.example.com', family: 4 }
const deps = { resolveEndpoint: async (_, host, port) => ({ ...endpoint, servername: host, port }), createImap: () => ({ connect: async () => {}, mailboxOpen: async () => {}, close() {} }), createSmtp: () => ({ verify: async () => true, close() {} }) }
async function fixture(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE pignus_ticket_settings(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE pignus_ticket_mail_outbox(id TEXT PRIMARY KEY, mailbox_key TEXT, status TEXT)')
    return { store: createMailChannelStore({ db, env }), db, close: () => db.close(), rows: (sql, params = []) => db.prepare(sql).all(...params), run: (sql, params = []) => db.prepare(sql).run(...params), other: otherEnv => createMailChannelStore({ db, env: otherEnv }) }
  }
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create(), sql = pgliteAdapter(pg)
  await pg.exec('CREATE TABLE pignus_ticket_settings(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE pignus_ticket_mail_outbox(id TEXT PRIMARY KEY, mailbox_key TEXT, status TEXT)')
  const prepare = statement => { let n = 0; return statement.replace(/\?/g, () => `$${++n}`) }
  return { store: createMailChannelStore({ sql, env }), close: () => pg.close(), rows: async (statement, params = []) => (await pg.query(prepare(statement), params)).rows, run: (statement, params = []) => pg.query(prepare(statement), params), other: otherEnv => createMailChannelStore({ sql, env: otherEnv }) }
}
const rejectCode = (fn, code) => assert.rejects(fn, error => error.code === code)
async function tested(store, value) { let current = await store.test({ version: value.version, direction: 'incoming' }, deps); return store.test({ version: current.version, direction: 'outgoing' }, deps) }

for (const engine of ['sqlite', 'postgres']) {
  test(`Canal correo ${engine}: cifrado, pruebas, activación y concurrencia`, async t => {
    const fx = await fixture(engine), { store } = fx
    try {
      let current
      await t.test('persistencia separada, cifrado autenticado y DTO sin secretos', async () => {
        await fx.run('INSERT INTO pignus_ticket_settings(id,data) VALUES (?,?)', ['config', '{"version":19,"nextNumber":20}'])
        const initial = await store.get()
        assert.equal(initial.version, 0); assert.equal(initial.encryptionReady, true); assert.equal(initial.configured, false)
        current = await store.save({ version: 0, settings: base() }, actor, { areas })
        assert.equal(current.version, 1); assert.equal(current.settings.incoming.passwordConfigured, true)
        assert.equal(current.settings.outgoing.passwordConfigured, true); assert.equal(current.enabled, false)
        const raw = (await fx.rows('SELECT data FROM pignus_ticket_settings WHERE id=?', ['mail-channel']))[0].data
        assert.ok(raw.includes('ciphertext')); assert.ok(!raw.includes(base().incoming.password)); assert.ok(!raw.includes(base().outgoing.password))
        assert.ok(!JSON.stringify(current).includes('ciphertext')); assert.ok(!JSON.stringify(current).includes(base().incoming.password))
        assert.equal((await fx.rows('SELECT data FROM pignus_ticket_settings WHERE id=?', ['config']))[0].data, '{"version":19,"nextNumber":20}')
        await rejectCode(() => store.save({ version: 0, settings: base() }, actor, { areas }), 'MAIL_VERSION_CONFLICT')
      })
      await t.test('no activa sin ambas pruebas; IMAP sólo lectura y SMTP verify', async () => {
        await rejectCode(() => store.activate({ version: current.version }, actor), 'MAIL_TEST_REQUIRED')
        let imapOptions, smtpOptions, folder, folderOptions, closed = 0
        current = await store.test({ version: current.version, direction: 'incoming' }, { ...deps, createImap: options => { imapOptions = options; return { connect: async () => {}, mailboxOpen: async (value, options) => { folder = value; folderOptions = options }, close: () => { closed++ } } } })
        assert.equal(folder, 'Pruebas'); assert.deepEqual(folderOptions, { readOnly: true }); assert.equal(imapOptions.auth.pass, base().incoming.password)
        assert.equal(imapOptions.tls.rejectUnauthorized, true); assert.equal(imapOptions.host, '8.8.8.8'); assert.equal(closed, 1)
        await rejectCode(() => store.activate({ version: current.version }, actor), 'MAIL_TEST_REQUIRED')
        current = await store.test({ version: current.version, direction: 'outgoing' }, { ...deps, createSmtp: options => { smtpOptions = options; return { verify: async () => true, sendMail: () => assert.fail('No enviar correo durante una prueba'), close: () => { closed++ } } } })
        assert.equal(smtpOptions.auth.pass, base().outgoing.password); assert.equal(smtpOptions.requireTLS, true)
        current = await store.activate({ version: current.version }, actor)
        assert.equal(current.enabled, true)
        const runtime = await store.runtime()
        assert.equal(runtime.password, base().incoming.password); assert.equal(runtime.smtpPassword, base().outgoing.password)
        assert.equal(runtime.areaId, 'technical'); assert.equal(runtime.configurationVersion, current.version)
      })
      await t.test('firma se guarda sin clave ni desactivar correo, alterar pruebas o credenciales', async () => {
        const before = JSON.parse((await fx.rows('SELECT data FROM pignus_ticket_settings WHERE id=?', ['mail-channel']))[0].data)
        const noKey = fx.other({})
        current = await noKey.saveSignature({ version: current.version, signature: { enabled: true, html: '<b>Soporte Pignus</b><br>3511234567', text: 'No confiar' } }, actor)
        assert.equal(current.enabled, true)
        assert.equal(current.signature.text, 'Soporte Pignus\n3511234567')
        assert.equal(current.signature.enabled, true)
        const after = JSON.parse((await fx.rows('SELECT data FROM pignus_ticket_settings WHERE id=?', ['mail-channel']))[0].data)
        assert.deepEqual(after.settings, before.settings)
        assert.deepEqual(after.tests, before.tests)
        assert.deepEqual(after.credentials, before.credentials)
        assert.equal(after.audit.at(-1).action, 'save-signature')
        assert.equal((await store.runtime()).signature.text, current.signature.text)
        assert.equal((await store.runtime()).password, base().incoming.password)
        await rejectCode(() => noKey.saveSignature({ version: before.version, signature: { enabled: false, html: '' } }, actor), 'MAIL_VERSION_CONFLICT')
        assert.equal((await store.get()).signature.enabled, true)
      })
      await t.test('save preserva claves sin devolverlas, invalida pruebas y desactiva', async () => {
        const input = base(); input.incoming.password = ''; delete input.outgoing.password
        current = await store.save({ version: current.version, settings: input }, actor, { areas })
        assert.equal(current.enabled, false); assert.equal(current.tests.incoming.ok, false); assert.equal(current.tests.outgoing.ok, false)
        assert.equal(current.signature.enabled, true); assert.match(current.signature.text, /Soporte Pignus/)
        assert.equal((await store.runtime()).password, '')
        const altered = structuredClone(input); altered.incoming.host = 'imap.otherdomain.com'
        await rejectCode(() => store.save({ version: current.version, settings: altered }, actor, { areas }), 'MAIL_CONFIGURATION')
        altered.incoming.password = 'clave-cambiada'
        current = await store.save({ version: current.version, settings: altered }, actor, { areas })
        assert.equal(current.settings.incoming.host, 'imap.otherdomain.com')
      })
      await t.test('configuración no admite áreas inactivas, HTTP, puertos arbitrarios ni TLS opcional', async () => {
        for (const change of [input => { input.areaId = 'inexistente' }, input => { input.incoming.host = 'https://imap.example.com' }, input => { input.incoming.port = 443 }, input => { input.outgoing.port = 25 }, input => { input.incoming.security = 'none' }, input => { input.incoming.security = 'starttls' }]) {
          const input = base(); change(input)
          await assert.rejects(() => store.save({ version: current.version, settings: input }, actor, { areas }))
        }
      })
      await t.test('pruebas fallidas no filtran credenciales ni errores del proveedor', async () => {
        current = await store.test({ version: current.version, direction: 'incoming' }, { ...deps, createImap: () => ({ connect: async () => { throw Object.assign(new Error('credential=' + base().incoming.password), { code: 'EAUTH' }) }, close() {} }) })
        assert.equal(current.tests.incoming.ok, false); assert.match(current.tests.incoming.message, /autenticar/)
        assert.ok(!JSON.stringify(current).includes(base().incoming.password)); assert.equal(current.enabled, false)
      })
      await t.test('CAS impide que una prueba vieja sobrescriba cambios simultáneos', async () => {
        let connected
        const ready = new Promise(resolve => { connected = resolve })
        let release
        const waiting = new Promise(resolve => { release = resolve })
        const attempt = store.test({ version: current.version, direction: 'incoming' }, { ...deps, createImap: () => ({ connect: async () => { connected(); await waiting }, mailboxOpen: async () => {}, close() {} }) })
        await ready
        current = await store.save({ version: current.version, settings: base() }, actor, { areas })
        release()
        await rejectCode(() => attempt, 'MAIL_VERSION_CONFLICT')
        assert.equal((await store.get()).tests.incoming.ok, false)
      })
      await t.test('requiere confirmación de fuente de prueba y pruebas recientes', async () => {
        current = await store.save({ version: current.version, settings: { ...base(), testSourceConfirmed: false } }, actor, { areas })
        current = await tested(store, current)
        await rejectCode(() => store.activate({ version: current.version }, actor), 'MAIL_TEST_SOURCE_REQUIRED')
        current = await store.save({ version: current.version, settings: base() }, actor, { areas })
        const old = new Date(Date.now() - TEST_TTL_MS - 1000).toISOString()
        current = await store.test({ version: current.version, direction: 'incoming' }, { ...deps, now: old })
        current = await store.test({ version: current.version, direction: 'outgoing' }, { ...deps, now: old })
        await rejectCode(() => store.activate({ version: current.version }, actor), 'MAIL_TEST_REQUIRED')
      })
      await t.test('cambio de buzón bloqueado si dejaría mensajes pendientes sin procesar', async () => {
        const key = (await store.runtime()).mailboxKey
        await fx.run('INSERT INTO pignus_ticket_mail_outbox(id,mailbox_key,status) VALUES (?,?,?)', ['pending', key, 'uncertain'])
        const settings = base(); settings.mode = 'live'
        await rejectCode(() => store.save({ version: current.version, settings }, actor, { areas }), 'MAIL_OUTBOX_PENDING')
        await fx.run('UPDATE pignus_ticket_mail_outbox SET status=? WHERE id=?', ['sent', 'pending'])
        current = await store.save({ version: current.version, settings }, actor, { areas })
        assert.equal(current.settings.mode, 'live')
      })
      await t.test('desactivar funciona aun sin clave o con clave rotada', async () => {
        current = await tested(store, current); current = await store.activate({ version: current.version }, actor)
        const noKey = fx.other({})
        assert.equal((await noKey.get()).encryptionReady, false)
        await rejectCode(() => noKey.runtime(), 'MAIL_CREDENTIAL_UNAVAILABLE')
        current = await noKey.disable({ version: current.version }, actor)
        assert.equal(current.enabled, false); assert.equal((await noKey.runtime()).enabled, false)
        const rotated = fx.other({ PIGNUS_SESSION_SECRET: 'otra-clave-totalmente-nueva-32-caracteres' })
        current = await rotated.save({ version: current.version, settings: base() }, actor, { areas })
        assert.equal(current.settings.incoming.passwordConfigured, true)
      })
      await t.test('alterar un secreto cifrado no permite usarlo ni verificar la conexión', async () => {
        const stored = JSON.parse((await fx.rows('SELECT data FROM pignus_ticket_settings WHERE id=?', ['mail-channel']))[0].data)
        stored.credentials.incoming.tag = Buffer.alloc(16).toString('base64')
        await fx.run('UPDATE pignus_ticket_settings SET data=? WHERE id=?', [JSON.stringify(stored), 'mail-channel'])
        const rotated = fx.other({ PIGNUS_SESSION_SECRET: 'otra-clave-totalmente-nueva-32-caracteres' })
        await rejectCode(() => rotated.test({ version: current.version, direction: 'incoming' }, deps), 'MAIL_CREDENTIAL_UNAVAILABLE')
        assert.ok(!JSON.stringify(await rotated.get()).includes(stored.credentials.incoming.ciphertext))
      })
    } finally { await fx.close() }
  })
}

test('Canal correo: DNS público fijado, IPv4/IPv6 y STARTTLS obligatorio', async () => {
  for (const host of ['127.0.0.1', '2130706433', '[::1]', 'localhost', 'mail.local', 'https://example.com', 'example.com:993', 'x@evil.com']) assert.throws(() => normalizeMailHost(host))
  for (const address of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.1.1', '169.254.169.254', '172.31.0.1', '192.168.1.1', '192.0.2.3', '198.18.0.1', '198.51.100.1', '203.0.113.2', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:0:1::1', '2002:7f00:1::1', '64:ff9b::7f00:1']) assert.equal(isPublicMailAddress(address), false, address)
  for (const address of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) assert.equal(isPublicMailAddress(address), true, address)
  await rejectCode(() => resolveMailEndpoint('imap', 'mail.example.com', 993, { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] }), 'MAIL_HOST_FORBIDDEN')
  let resolutions = 0
  const target = await resolveMailEndpoint('imap', 'mail.example.com', 993, { lookup: async () => { resolutions++; return [{ address: '8.8.8.8', family: 4 }] } })
  assert.equal(target.host, '8.8.8.8'); assert.equal(target.servername, 'mail.example.com')
  await new Promise((resolve, reject) => target.lookup('attacker.example.com', {}, (error, ip) => { if (error) reject(error); else { assert.equal(ip, '8.8.8.8'); resolve() } }))
  assert.equal(resolutions, 1)
  const settings = base(); settings.incoming.security = 'starttls'; settings.incoming.port = 143; settings.outgoing.security = 'starttls'; settings.outgoing.port = 587
  const imap = connectionOptions(settings, 'incoming', 'secret', { ...target, port: 143 }), smtp = connectionOptions(settings, 'outgoing', 'secret', { ...target, port: 587 })
  assert.equal(imap.doSTARTTLS, true); assert.equal(imap.secure, false); assert.equal(smtp.requireTLS, true); assert.equal(smtp.secure, false)
})

test('Canal correo: hereda entorno sólo mientras no haya registro administrado', async () => {
  const fx = await fixture('sqlite')
  try {
    const legacy = fx.other({ ...env, TICKETS_MAIL_ENABLED: 'true', TICKETS_MAIL_MODE: 'test', TICKETS_MAIL_TEST_SOURCE_CONFIRMED: 'true', TICKETS_MAIL_ADDRESS: 'soporte@example.com', TICKETS_MAIL_USER: 'soporte@example.com', TICKETS_MAIL_PASSWORD: 'secret-env' })
    assert.equal((await legacy.runtime()).password, 'secret-env')
    await legacy.disable({ version: 0 }, actor)
    assert.equal((await legacy.runtime()).enabled, false)
    await rejectCode(() => fx.other({}).save({ version: 1, settings: base() }, actor, { areas }), 'MAIL_ENCRYPTION_UNAVAILABLE')
  } finally { await fx.close() }
})

test('Canal correo: desactivar una cuenta vacía nunca habilita conexiones sin credenciales', async () => {
  const fx = await fixture('sqlite')
  try {
    const current = await fx.store.disable({ version: 0 }, actor)
    await rejectCode(() => fx.store.saveSignature({ version: current.version, signature: { enabled: true, html: 'Firma' } }, actor), 'MAIL_NOT_CONFIGURED')
    await rejectCode(() => fx.store.test({ version: current.version, direction: 'incoming' }, deps), 'MAIL_MISSING_CREDENTIALS')
    await rejectCode(() => fx.store.activate({ version: current.version }, actor), 'MAIL_MISSING_CREDENTIALS')
  } finally { await fx.close() }
})

test('Canal correo: ejecutor externo conserva la transacción y evita otra conexión del pool', async () => {
  const fx = await fixture('sqlite')
  try {
    const statements = []
    const store = createMailChannelStore({ env, query: async (statement, params = []) => {
      statements.push(statement)
      assert.ok(!/\$\d+/.test(statement), 'El adaptador externo recibe parámetros ? sin traducir')
      const prepared = fx.db.prepare(statement)
      if (/^SELECT|\bRETURNING\b/i.test(statement)) return prepared.all(...params)
      prepared.run(...params); return []
    } })
    fx.db.exec('BEGIN')
    let current = await store.save({ version: 0, settings: base() }, actor, { areas })
    current = await tested(store, current)
    current = await store.activate({ version: current.version }, actor)
    const runtime = await store.runtime()
    assert.equal(runtime.password, base().incoming.password)
    assert.equal(runtime.configurationVersion, current.version)
    fx.db.exec('ROLLBACK')
    assert.equal((await store.get()).version, 0)
    assert.ok(statements.length > 5)
  } finally { await fx.close() }
})
