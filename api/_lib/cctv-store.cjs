const { createHash } = require('node:crypto')
const { sqlParameters } = require('./ticket-mail-store.cjs')
const { ensureCommittedSchema } = require('./schema-readiness.cjs')
const model = require('./cctv-model.cjs')
const { validateCctvAttachment, attachmentMetadata } = require('./cctv-attachments.cjs')

const TABLES = ['pignus_cctv_dossiers', 'pignus_cctv_attachments', 'pignus_cctv_commands']
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS pignus_cctv_dossiers (customer_id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>=0), updated_at TEXT, pending_improvements INTEGER NOT NULL DEFAULT 0, equipment_count INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pignus_cctv_attachments (customer_id TEXT NOT NULL REFERENCES pignus_cctv_dossiers(customer_id), id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=3145728), digest TEXT NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL, uploaded_by TEXT NOT NULL, PRIMARY KEY(customer_id,id))',
  'CREATE TABLE IF NOT EXISTS pignus_cctv_commands (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES pignus_cctv_dossiers(customer_id), fingerprint TEXT NOT NULL, result_version INTEGER NOT NULL, created_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pignus_cctv_commands_customer ON pignus_cctv_commands (customer_id,created_at)'
]
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const fingerprint = command => createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex')
const parse = row => row ? JSON.parse(row.data) : null

// The command is a generator so the SQLite transaction executes synchronously:
// no asynchronous callback can read or modify its partially written state.
function* writeCommand(command, user, file, hash, pg) {
  if (pg) {
    yield ['SELECT pg_advisory_xact_lock(hashtext(?))', [`cctv-command:${command.commandId}`]]
    yield ['SELECT pg_advisory_xact_lock(hashtext(?))', [`cctv-customer:${command.customerId}`]]
  }
  const previousCommand = (yield ['SELECT actor_id,customer_id,fingerprint FROM pignus_cctv_commands WHERE id=?', [command.commandId]])[0]
  const rows = yield [`SELECT version,data FROM pignus_cctv_dossiers WHERE customer_id=?${pg ? ' FOR UPDATE' : ''}`, [command.customerId]]
  const current = parse(rows[0]) || model.emptyDossier(command.customerId)
  if (previousCommand) {
    if (previousCommand.actor_id !== String(user.id) || previousCommand.customer_id !== command.customerId || previousCommand.fingerprint !== hash) model.fail('Este identificador ya se utilizó para otra operación.', 409, 'CCTV_COMMAND_CONFLICT')
    return current
  }
  if (current.version !== command.expectedVersion) throw Object.assign(new Error('Esta ficha cambió desde otra sesión. Actualizala antes de volver a guardar.'), { statusCode: 409, code: 'CCTV_VERSION_CONFLICT', currentVersion: current.version })
  const at = new Date().toISOString()
  const dossier = model.applyCctvCommand(current, command, user, attachmentMetadata(file), at)
  const counts = [dossier.improvements.filter(item => !item.completed).length, dossier.equipment.reduce((sum, item) => sum + item.quantity, 0)]
  if (rows.length) {
    const saved = yield ['UPDATE pignus_cctv_dossiers SET version=?,updated_at=?,pending_improvements=?,equipment_count=?,data=? WHERE customer_id=? AND version=? RETURNING customer_id', [dossier.version, at, ...counts, JSON.stringify(dossier), command.customerId, command.expectedVersion]]
    if (!saved.length) model.fail('La ficha cambió durante el guardado. Actualizala para continuar.', 409, 'CCTV_VERSION_CONFLICT')
  } else yield ['INSERT INTO pignus_cctv_dossiers (customer_id,version,updated_at,pending_improvements,equipment_count,data) VALUES (?,?,?,?,?,?)', [command.customerId, dossier.version, at, ...counts, JSON.stringify(dossier)]]
  if (file) yield ['INSERT INTO pignus_cctv_attachments (customer_id,id,file_name,mime_type,byte_size,digest,content,created_at,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)', [command.customerId, file.id, file.fileName, file.mimeType, file.byteSize, file.digest, file.data, at, String(user.id)]]
  yield ['INSERT INTO pignus_cctv_commands (id,actor_id,customer_id,fingerprint,result_version,created_at) VALUES (?,?,?,?,?,?)', [command.commandId, String(user.id), command.customerId, hash, dossier.version, at]]
  return dossier
}

function createCctvStore({ sql, db }) {
  if (!sql && !db) throw new TypeError('Se necesita una conexión a la base de datos.')
  const pg = Boolean(sql)
  let sqliteReady = false
  const sqliteQuery = (query, values = []) => {
    const statement = db.prepare(query)
    if (/^\s*SELECT|\bRETURNING\b/i.test(query)) return statement.all(...values)
    statement.run(...values); return []
  }
  const query = pg ? (statement, values = []) => sql.unsafe(sqlParameters(statement), values) : sqliteQuery
  async function ensure() {
    if (pg) return ensureCommittedSchema(sql, 'cctv-services-v1', async tx => {
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('cctv-services-schema-v1'))")
      for (const statement of SCHEMA) await tx.unsafe(statement.replace('content BLOB', 'content BYTEA'))
      for (const table of TABLES) {
        await tx.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
        await tx.unsafe(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`)
        await tx.unsafe(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE ${table} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE ${table} FROM authenticated; END IF; END $$`)
      }
    })
    if (!sqliteReady) {
      db.exec('BEGIN IMMEDIATE')
      try { for (const statement of SCHEMA) db.exec(statement); db.exec('COMMIT'); sqliteReady = true }
      catch (error) { db.exec('ROLLBACK'); throw error }
    }
  }
  async function runGenerator(generator) {
    if (pg) return sql.begin(async tx => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      let step = generator.next()
      while (!step.done) step = generator.next(await tx.unsafe(sqlParameters(step.value[0]), step.value[1]))
      return step.value
    })
    db.exec('BEGIN IMMEDIATE')
    try {
      let step = generator.next()
      while (!step.done) step = generator.next(sqliteQuery(...step.value))
      db.exec('COMMIT'); return step.value
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  const access = () => require('./cctv-access.cjs')
  async function list(user, state) {
    const customers = access().listCctvCustomers(user, state)
    await ensure()
    const summaries = new Map()
    for (let offset = 0; offset < customers.length; offset += 250) {
      const ids = customers.slice(offset, offset + 250).map(customer => String(customer.customerId))
      for (const row of await query(`SELECT customer_id,updated_at,pending_improvements,equipment_count FROM pignus_cctv_dossiers WHERE customer_id IN (${ids.map(() => '?').join(',')})`, ids)) summaries.set(row.customer_id, row)
    }
    return { capabilities: access().cctvCapabilities(user), customers: customers.map(customer => {
      const row = summaries.get(String(customer.customerId))
      return { ...access().presentCctvCustomer(customer, user), updatedAt: row?.updated_at || null, pendingImprovements: Number(row?.pending_improvements || 0), equipmentCount: Number(row?.equipment_count || 0) }
    }) }
  }
  async function detail(user, state, customerId) {
    const customer = access().assertCctvAccess(user, state, customerId)
    await ensure()
    const dossier = parse((await query('SELECT data FROM pignus_cctv_dossiers WHERE customer_id=?', [String(customer.customerId)]))[0]) || model.emptyDossier(customer.customerId)
    return { customer: access().presentCctvCustomer(customer, user), dossier, capabilities: access().cctvCapabilities(user) }
  }
  async function run(user, state, input) {
    const customer = access().assertCctvAccess(user, state, input?.customerId, { write: true })
    const command = model.validateCommand(input)
    if (command.customerId !== String(customer.customerId)) model.fail('La cuenta no es válida.')
    const file = validateCctvAttachment(command.payload.file, command.action)
    const hash = fingerprint(command)
    await ensure()
    const dossier = await runGenerator(writeCommand(command, user, file, hash, pg))
    return { customer: access().presentCctvCustomer(customer, user), dossier, capabilities: access().cctvCapabilities(user) }
  }
  async function attachment(user, state, customerId, attachmentId) {
    const customer = access().assertCctvAccess(user, state, customerId, { download: true })
    if (typeof attachmentId !== 'string' || !attachmentId || attachmentId.length > 200) model.fail('El adjunto no es válido.')
    await ensure()
    const row = (await query('SELECT file_name,mime_type,byte_size,content FROM pignus_cctv_attachments WHERE customer_id=? AND id=?', [String(customer.customerId), attachmentId]))[0]
    if (!row) model.fail('No se encontró el adjunto de esta cuenta.', 404, 'CCTV_ATTACHMENT_NOT_FOUND')
    return { fileName: row.file_name, mimeType: row.mime_type, byteSize: Number(row.byte_size), data: Buffer.from(row.content) }
  }
  return { ensure, list, detail, run, attachment }
}

module.exports = { createCctvStore, SCHEMA, TABLES }
