const { createCipheriv, createDecipheriv, hkdfSync, randomBytes, createHash } = require('node:crypto')
const { emailAddress, ticketMailConfig } = require('./ticket-mail.cjs')
const { normalizeMailHost, validateMailPort, resolveMailEndpoint } = require('./ticket-mail-network.cjs')

const ID = 'mail-channel'
const TEST_TTL_MS = 24 * 60 * 60 * 1000
const failure = (message, code = 'MAIL_CONFIGURATION', statusCode = 400) => Object.assign(new Error(message), { code, statusCode })
const conflict = () => failure('La configuración del correo cambió. Actualizá la pantalla antes de continuar.', 'MAIL_VERSION_CONFLICT', 409)
const clean = (value, limit = 254) => String(value || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, limit)
const emptyTest = () => ({ ok: false, at: null, message: '' })

function encryptionKey(env) {
  const secret = env.TICKETS_MAIL_ENCRYPTION_KEY || env.PIGNUS_SESSION_SECRET || ''
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) throw failure('El servidor necesita una clave de cifrado de al menos 32 caracteres para guardar el correo.', 'MAIL_ENCRYPTION_UNAVAILABLE', 503)
  return Buffer.from(hkdfSync('sha256', secret, 'agentec-tickets-mail-v1', 'credential-storage', 32))
}

function encryptionReady(env) { try { encryptionKey(env); return true } catch { return false } }

function credentialContext(settings, direction) {
  const part = settings[direction]
  return JSON.stringify([ID, direction, settings.address, part.host, part.user])
}

function encryptPassword(password, settings, direction, env) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv)
  cipher.setAAD(Buffer.from(credentialContext(settings, direction)))
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return { algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

function decryptPassword(secret, settings, direction, env) {
  if (!secret) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(secret.iv, 'base64'))
    decipher.setAAD(Buffer.from(credentialContext(settings, direction)))
    decipher.setAuthTag(Buffer.from(secret.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  } catch { throw failure('No se pudo abrir la credencial guardada. Revisá la clave del servidor o volvé a ingresar la contraseña.', 'MAIL_CREDENTIAL_UNAVAILABLE', 503) }
}

function defaultChannel(env) {
  return {
    version: 0, enabled: false, updatedAt: null,
    settings: {
      address: emailAddress(env.TICKETS_MAIL_ADDRESS), senderName: clean(env.TICKETS_MAIL_SENDER_NAME || 'Soporte', 120),
      mode: env.TICKETS_MAIL_MODE === 'live' ? 'live' : 'test', testSourceConfirmed: env.TICKETS_MAIL_TEST_SOURCE_CONFIRMED === 'true', areaId: '',
      incoming: { protocol: 'imap', host: clean(env.TICKETS_MAIL_IMAP_HOST || 'imap.secureserver.net'), port: 993, security: 'tls', user: clean(env.TICKETS_MAIL_USER), folder: clean(env.TICKETS_MAIL_FOLDER || 'INBOX', 500) },
      outgoing: { protocol: 'smtp', host: clean(env.TICKETS_MAIL_SMTP_HOST || 'smtpout.secureserver.net'), port: 465, security: 'tls', user: '', useIncomingCredentials: true }
    },
    credentials: {}, tests: { incoming: emptyTest(), outgoing: emptyTest() }, audit: []
  }
}

function normalizeSettings(input, areas) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Completá la configuración de correo.')
  const address = emailAddress(input.address)
  if (!address) throw failure('Ingresá una dirección de correo válida.')
  const senderName = clean(input.senderName, 120)
  if (!senderName) throw failure('Ingresá el nombre del remitente.')
  if (!['test', 'live'].includes(input.mode)) throw failure('Seleccioná el modo de prueba o producción.')
  const areaId = clean(input.areaId, 120)
  if (!areaId || !Array.isArray(areas) || !areas.some(area => String(area.id) === areaId && area.active !== false)) throw failure('Seleccioná un área de destino activa para los tickets recibidos.')
  const incoming = normalizeServer(input.incoming, 'imap'), outgoing = normalizeServer(input.outgoing, 'smtp')
  incoming.folder = clean(input.incoming?.folder || 'INBOX', 500)
  outgoing.useIncomingCredentials = input.outgoing?.useIncomingCredentials === true
  if (!incoming.user || (!outgoing.useIncomingCredentials && !outgoing.user)) throw failure('Ingresá el usuario para ambos servidores de correo.')
  if (outgoing.useIncomingCredentials) outgoing.user = ''
  return { address, senderName, mode: input.mode, testSourceConfirmed: input.testSourceConfirmed === true, areaId, incoming, outgoing }
}

function normalizeServer(input, protocol) {
  if (!input || (input.protocol && input.protocol !== protocol)) throw failure(`El protocolo admitido es ${protocol.toUpperCase()}.`)
  const host = normalizeMailHost(input.host), port = validateMailPort(protocol, input.port)
  const security = input.security
  if (!['tls', 'starttls'].includes(security) || ((port === 993 || port === 465) !== (security === 'tls'))) throw failure('El puerto y la seguridad no coinciden. Usá TLS en 993/465 o STARTTLS en 143/587.')
  return { protocol, host, port, security, user: clean(input.user) }
}

function suppliedPassword(input) {
  if (input === undefined || input === null || input === '') return ''
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 4096 || /[\x00\r\n]/.test(input)) throw failure('La contraseña no tiene un formato válido.')
  return input
}

function audit(record, action, user, at) {
  record.audit = [...(record.audit || []), { action, at, userId: clean(user?.id || '', 120), userName: clean(user?.name || '', 120) }].slice(-100)
}

function safeTestFailure(error) {
  if (error?.code === 'EAUTH' || error?.authenticationFailed) return 'No se pudo autenticar. Revisá el usuario y la contraseña.'
  if (['ETIMEDOUT', 'MAIL_TEST_TIMEOUT', 'MAIL_DNS_TIMEOUT'].includes(error?.code)) return 'Se agotó el tiempo de conexión. Revisá el servidor y el puerto.'
  if (['MAIL_HOST_FORBIDDEN', 'MAIL_HOST_INVALID', 'MAIL_PORT_INVALID', 'MAIL_DNS_FAILED'].includes(error?.code)) return 'El servidor no resuelve a un destino público válido para correo.'
  if (/CERT|TLS|SSL/.test(String(error?.code || ''))) return 'No se pudo validar la conexión segura del servidor.'
  return 'No se pudo verificar la conexión. Revisá los datos del servidor, el acceso y la carpeta seleccionada.'
}

function connectionOptions(settings, direction, password, endpoint) {
  const part = settings[direction], incoming = direction === 'incoming'
  const options = {
    host: endpoint.host, port: endpoint.port, servername: endpoint.servername,
    secure: part.security === 'tls', auth: { user: !incoming && part.useIncomingCredentials ? settings.incoming.user : part.user, pass: password },
    tls: { servername: endpoint.servername, rejectUnauthorized: true, minVersion: 'TLSv1.2', lookup: endpoint.lookup },
    logger: false, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 15000
  }
  if (incoming) { options.disableAutoIdle = true; if (!options.secure) options.doSTARTTLS = true }
  else { options.requireTLS = true; options.disableFileAccess = true; options.disableUrlAccess = true; options.debug = false }
  return options
}

function createMailChannelStore({ sql, db, query: executor, env = process.env }) {
  if (!sql && !db && typeof executor !== 'function') throw new Error('Se requiere almacenamiento para el canal de correo.')
  // El ejecutor permite compartir la transacción que bloqueó mail-channel al encolar una respuesta.
  const query = typeof executor === 'function' ? executor : sql ? (statement, params = []) => { let n = 0; return sql.unsafe(statement.replace(/\?/g, () => `$${++n}`), params) } : async (statement, params = []) => {
    const prepared = db.prepare(statement)
    if (/^SELECT|\bRETURNING\b/i.test(statement)) return prepared.all(...params)
    prepared.run(...params); return []
  }
  async function read() {
    const row = (await query('SELECT data FROM pignus_ticket_settings WHERE id=?', [ID]))[0]
    return row ? { record: JSON.parse(row.data), raw: row.data, configured: true } : { record: defaultChannel(env), raw: null, configured: false }
  }
  function dto(record, configured = true) {
    const settings = JSON.parse(JSON.stringify(record.settings))
    settings.incoming.passwordConfigured = Boolean(record.credentials?.incoming || (!configured && env.TICKETS_MAIL_PASSWORD))
    settings.outgoing.passwordConfigured = settings.outgoing.useIncomingCredentials ? settings.incoming.passwordConfigured : Boolean(record.credentials?.outgoing)
    return { version: record.version, settings, tests: record.tests, enabled: record.enabled === true, encryptionReady: encryptionReady(env), configured, updatedAt: record.updatedAt }
  }
  function checkVersion(record, version) { if (!Number.isInteger(version) || version !== record.version) throw conflict() }
  async function persist(previous, record, pendingMailboxKey = null) {
    record.version = previous.record.version + 1
    record.updatedAt = new Date().toISOString()
    const raw = JSON.stringify(record)
    const pendingClause = pendingMailboxKey ? " AND NOT EXISTS(SELECT 1 FROM pignus_ticket_mail_outbox WHERE mailbox_key=? AND status IN ('queued','retry','sending','uncertain'))" : ''
    const rows = previous.raw === null
      ? await query(`INSERT INTO pignus_ticket_settings(id,data) SELECT ?,? WHERE 1=1${pendingClause} ON CONFLICT(id) DO NOTHING RETURNING id`, [ID, raw, ...(pendingMailboxKey ? [pendingMailboxKey] : [])])
      : await query(`UPDATE pignus_ticket_settings SET data=? WHERE id=? AND data=?${pendingClause} RETURNING id`, [raw, ID, previous.raw, ...(pendingMailboxKey ? [pendingMailboxKey] : [])])
    if (!rows.length) {
      if (pendingMailboxKey && (await query("SELECT id FROM pignus_ticket_mail_outbox WHERE mailbox_key=? AND status IN ('queued','retry','sending','uncertain') LIMIT 1", [pendingMailboxKey])).length) throw failure('La cuenta tiene correos pendientes o de entrega incierta. Resolvé esos envíos antes de cambiar el buzón, carpeta o modo.', 'MAIL_OUTBOX_PENDING', 409)
      throw conflict()
    }
    return dto(record)
  }
  function passwords(previous) {
    return previous.configured ? {
      incoming: decryptPassword(previous.record.credentials?.incoming, previous.record.settings, 'incoming', env),
      outgoing: decryptPassword(previous.record.credentials?.outgoing, previous.record.settings, 'outgoing', env)
    } : { incoming: String(env.TICKETS_MAIL_PASSWORD || ''), outgoing: '' }
  }
  function completeCredentials(previous) {
    const secrets = passwords(previous), settings = previous.record.settings
    if (!emailAddress(settings.address) || !settings.incoming.user || !secrets.incoming || (!settings.outgoing.useIncomingCredentials && (!settings.outgoing.user || !secrets.outgoing))) {
      throw failure('Completá y guardá las credenciales de correo antes de continuar.', 'MAIL_MISSING_CREDENTIALS', 409)
    }
    return secrets
  }
  return {
    async get() { const previous = await read(); return dto(previous.record, previous.configured) },
    async save({ version, settings: input }, user, { areas } = {}) {
      const previous = await read(); checkVersion(previous.record, version); encryptionKey(env)
      const settings = normalizeSettings(input, areas), old = previous.record.settings
      const incomingSupplied = suppliedPassword(input.incoming?.password), outgoingSupplied = suppliedPassword(input.outgoing?.password)
      const changed = direction => old.address !== settings.address || old[direction].host !== settings[direction].host || old[direction].user !== settings[direction].user
      if ((changed('incoming') || (settings.outgoing.useIncomingCredentials && changed('outgoing'))) && !incomingSupplied) throw failure('Volvé a ingresar la contraseña entrante al cambiar el servidor, usuario o dirección de correo.')
      if (!settings.outgoing.useIncomingCredentials && changed('outgoing') && !outgoingSupplied) throw failure('Volvé a ingresar la contraseña saliente al cambiar el servidor, usuario o dirección de correo.')
      // Una credencial nueva permite recuperarse incluso si cambió la clave de cifrado del servidor.
      const needsOldIncoming = !incomingSupplied, needsOldOutgoing = !settings.outgoing.useIncomingCredentials && !outgoingSupplied
      const oldPasswords = needsOldIncoming || needsOldOutgoing ? passwords(previous) : {}
      const incomingPassword = incomingSupplied || oldPasswords.incoming, outgoingPassword = settings.outgoing.useIncomingCredentials ? '' : outgoingSupplied || oldPasswords.outgoing
      if (!incomingPassword || (!settings.outgoing.useIncomingCredentials && !outgoingPassword)) throw failure('Ingresá las contraseñas del correo antes de guardar.')
      const record = { ...previous.record, settings, enabled: false, credentials: { incoming: encryptPassword(incomingPassword, settings, 'incoming', env), ...(outgoingPassword ? { outgoing: encryptPassword(outgoingPassword, settings, 'outgoing', env) } : {}) }, tests: { incoming: emptyTest(), outgoing: emptyTest() } }
      audit(record, 'save', user, new Date().toISOString())
      const mailboxKey = value => createHash('sha256').update([value.incoming.host, value.address, value.incoming.folder, value.mode].join('\n')).digest('hex')
      const oldMailboxKey = mailboxKey(old)
      return persist(previous, record, oldMailboxKey !== mailboxKey(settings) ? oldMailboxKey : null)
    },
    async test({ version, direction }, deps = {}) {
      if (!['incoming', 'outgoing'].includes(direction)) throw failure('Seleccioná el correo entrante o saliente.')
      const previous = await read(); checkVersion(previous.record, version)
      if (!previous.configured) throw failure('Guardá la configuración antes de probar la conexión.')
      const record = JSON.parse(JSON.stringify(previous.record)), settings = record.settings, secrets = completeCredentials(previous)
      const part = settings[direction], resolve = deps.resolveEndpoint || resolveMailEndpoint
      let client, timer, result, expired = false
      const now = deps.now ? new Date(deps.now).toISOString() : new Date().toISOString()
      try {
        await Promise.race([
          (async () => {
            const endpoint = await resolve(part.protocol, part.host, part.port)
            if (expired) throw failure('Tiempo de conexión agotado.', 'MAIL_TEST_TIMEOUT')
            const password = direction === 'outgoing' && part.useIncomingCredentials ? secrets.incoming : secrets[direction]
            const options = connectionOptions(settings, direction, password, endpoint)
            if (direction === 'incoming') {
              client = deps.createImap ? deps.createImap(options) : new (require('imapflow').ImapFlow)(options)
              client.on?.('error', () => {})
              await client.connect()
              if (expired) { try { client.close?.() } catch {}; throw failure('Tiempo de conexión agotado.', 'MAIL_TEST_TIMEOUT') }
              await client.mailboxOpen(settings.incoming.folder, { readOnly: true })
            } else {
              client = deps.createSmtp ? deps.createSmtp(options) : require('nodemailer').createTransport(options)
              await client.verify()
            }
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(failure('Tiempo de conexión agotado.', 'MAIL_TEST_TIMEOUT')) }, 20000); timer.unref?.() })
        ])
        result = { ok: true, at: now, message: direction === 'incoming' ? 'Acceso al buzón y carpeta verificados. No se leyeron ni modificaron mensajes.' : 'Conexión y autenticación verificadas. No se envió ningún correo.' }
      } catch (error) { result = { ok: false, at: now, message: safeTestFailure(error) }; record.enabled = false }
      finally { clearTimeout(timer); try { client?.close?.() } catch {} }
      record.tests[direction] = result
      audit(record, `test-${direction}`, deps.user, now)
      return persist(previous, record)
    },
    async activate({ version }, user, { now = new Date(), areas } = {}) {
      const previous = await read(); checkVersion(previous.record, version)
      if (!previous.configured) throw failure('Guardá la configuración antes de activarla.')
      const record = JSON.parse(JSON.stringify(previous.record)), at = new Date(now).getTime()
      completeCredentials(previous)
      if (areas && !areas.some(area => String(area.id) === record.settings.areaId && area.active !== false)) throw failure('El área de destino ya no está activa.')
      for (const direction of ['incoming', 'outgoing']) {
        const item = record.tests[direction], age = at - new Date(item?.at).getTime()
        if (!item?.ok || !Number.isFinite(age) || age < 0 || age > TEST_TTL_MS) throw failure('Probá ambas conexiones antes de activar el correo. Las pruebas son válidas por 24 horas.', 'MAIL_TEST_REQUIRED', 409)
      }
      if (record.settings.mode === 'test' && !record.settings.testSourceConfirmed) throw failure('Confirmá que el buzón o carpeta de prueba está separado del correo habitual.', 'MAIL_TEST_SOURCE_REQUIRED', 409)
      record.enabled = true; audit(record, 'activate', user, new Date(now).toISOString())
      return persist(previous, record)
    },
    async disable({ version }, user) {
      const previous = await read(); checkVersion(previous.record, version)
      const record = JSON.parse(JSON.stringify(previous.record))
      record.enabled = false; audit(record, 'disable', user, new Date().toISOString())
      return persist(previous, record)
    },
    async runtime() {
      const previous = await read()
      if (!previous.configured) return ticketMailConfig(env)
      const { record } = previous, settings = record.settings
      const config = { ...ticketMailConfig({ ...env, TICKETS_MAIL_ENABLED: 'false', TICKETS_MAIL_MODE: settings.mode }), enabled: record.enabled, mode: settings.mode, address: settings.address, senderName: settings.senderName, areaId: settings.areaId, user: settings.incoming.user, password: '', imapHost: settings.incoming.host, imapPort: settings.incoming.port, imapSecurity: settings.incoming.security, mailbox: settings.incoming.folder, smtpHost: settings.outgoing.host, smtpPort: settings.outgoing.port, smtpSecurity: settings.outgoing.security, smtpUser: settings.outgoing.useIncomingCredentials ? settings.incoming.user : settings.outgoing.user, smtpPassword: '', testSourceConfirmed: settings.testSourceConfirmed, configurationVersion: record.version }
      if (record.enabled) { const secrets = completeCredentials(previous); config.password = secrets.incoming; config.smtpPassword = settings.outgoing.useIncomingCredentials ? secrets.incoming : secrets.outgoing }
      config.mailboxKey = createHash('sha256').update([config.imapHost, config.address, config.mailbox, config.mode].join('\n')).digest('hex')
      return config
    }
  }
}

module.exports = { createMailChannelStore, connectionOptions, safeTestFailure, TEST_TTL_MS }
