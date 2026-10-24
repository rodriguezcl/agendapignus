const crypto = require('node:crypto')
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }) }
function operation(body) {
  if (body.operationId == null && !body.resolveOperation) return null
  if (typeof body.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.operationId)) fail(400, 'Identificador de importación inválido.')
  if (!body.resolveOperation && body.responseMode !== 'compact-v1') fail(400, 'La importación recuperable requiere respuesta compacta.')
  return { id: body.operationId, hash: body.resolveOperation ? null : crypto.createHash('sha256').update(JSON.stringify({ revision: body.revision, customers: body.customers })).digest('hex') }
}
function decide(row, user, body, op) {
  if (!row) return body.resolveOperation ? { operationId: op.id, operationStatus: 'aborted' } : null
  if (row.actor_id !== String(user.id)) fail(403, 'La importación pertenece a otro usuario del conector.')
  if (body.resolveOperation) return row.result
  if (row.status === 'aborted') fail(409, 'Este intento fue cerrado sin importar. Iniciá una nueva sincronización.')
  if (row.payload_hash !== op.hash) fail(409, 'El identificador ya corresponde a otra importación.')
  return row.result
}
async function ensure(sql) {
  await require('./schema-readiness.cjs').ensureCommittedSchema(sql, 'customer-import-recovery-v1', async tx => {
    await tx`create table if not exists pignus_customer_import_operations (id uuid primary key, actor_id text not null, status text not null check (status in ('completed','aborted')), payload_hash text, result jsonb not null, created_at timestamptz not null default now())`
    await tx`alter table pignus_customer_import_operations enable row level security`
    await tx`revoke all on pignus_customer_import_operations from anon, authenticated`
  })
}
// Both import and resolve MUST hold the state_revision row lock. A resolution
// seals an absent operation, so a delayed original POST can never commit later.
async function prepare(tx, user, body) {
  const op = operation(body)
  if (!op) return null
  const [row] = await tx`select actor_id, status, payload_hash, result from pignus_customer_import_operations where id = ${op.id}`
  const result = decide(row, user, body, op)
  if (!row && result) await tx`insert into pignus_customer_import_operations (id, actor_id, status, result) values (${op.id}, ${String(user.id)}, 'aborted', ${tx.json(result)})`
  return result
}
async function complete(tx, user, body, result) {
  const op = operation(body)
  if (!op) return result
  const receipt = { ...result, operationId: op.id, operationStatus: 'completed' }
  await tx`insert into pignus_customer_import_operations (id, actor_id, status, payload_hash, result) values (${op.id}, ${String(user.id)}, 'completed', ${op.hash}, ${tx.json(receipt)})`
  return receipt
}
function ensureLocal(db) {
  db.exec("CREATE TABLE IF NOT EXISTS customer_import_operations (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, status TEXT NOT NULL, payload_hash TEXT, result TEXT NOT NULL)")
}
function prepareLocal(db, user, body) {
  const op = operation(body)
  if (!op) return null
  const row = db.prepare('SELECT * FROM customer_import_operations WHERE id = ?').get(op.id)
  if (row) row.result = JSON.parse(row.result)
  const result = decide(row, user, body, op)
  if (!row && result) db.prepare("INSERT INTO customer_import_operations (id, actor_id, status, result) VALUES (?, ?, 'aborted', ?)").run(op.id, String(user.id), JSON.stringify(result))
  return result
}
function completeLocal(db, user, body, result) {
  const op = operation(body)
  if (!op) return result
  const receipt = { ...result, operationId: op.id, operationStatus: 'completed' }
  db.prepare("INSERT INTO customer_import_operations (id, actor_id, status, payload_hash, result) VALUES (?, ?, 'completed', ?, ?)").run(op.id, String(user.id), op.hash, JSON.stringify(receipt))
  return receipt
}
module.exports = { ensure, prepare, complete, ensureLocal, prepareLocal, completeLocal }
