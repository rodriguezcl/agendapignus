const crypto = require('node:crypto')
const { decodeAttachment, fail } = require('./attachments.cjs')
const permissions = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')
const domain = import('../../src/domain/collections/collections.mjs')
const receiptMetadata = file => Object.fromEntries(['id', 'name', 'mime', 'bytes', 'digest', 'createdAt', 'uploadedBy'].map(key => [key, file[key]]))

function receiptOwner(state, recordId, user, writing, { hasCollection, collectionService }) {
  if (!permissions.can(user, 'collections.view') || !permissions.can(user, 'records.financial')) throw fail('No tenés permiso para consultar comprobantes de cobranzas.', 403)
  const owner = state.history?.find(record => String(record.id) === String(recordId))
  if (!owner || !hasCollection(owner, state.history)) throw fail('La cobranza ya no está disponible.', 404)
  const effective = collectionService(owner, state.history) || owner
  for (const record of [owner, effective]) {
    if (!read.serviceReadable(record, user, state) || writing && !read.serviceWritable(record, user, state)) throw fail('La cobranza no está incluida en tu alcance.', 403)
  }
  return owner
}

function verifiedReceipt(file, reference) {
  return Boolean(file && file.data?.length && file.data.length === file.bytes && file.id === reference.id &&
    file.digest === reference.digest && file.mime === reference.mime && file.bytes === reference.bytes &&
    crypto.createHash('sha256').update(file.data).digest('hex') === file.digest)
}

// Only this server-side result may be passed as receipt evidence to the domain.
// A new file is decoded here but inserted only after all business checks pass,
// inside the same transaction that writes the collection and audit event.
function receiptCandidate(state, input, user, now, helpers) {
  const owner = receiptOwner(state, input.recordId, user, true, helpers)
  if (input.receipt != null) {
    if (!permissions.can(user, 'collections.confirm')) throw fail('No tenés permiso para adjuntar comprobantes de pago.', 403)
    const file = { ...decodeAttachment(input.receipt), createdAt: now, uploadedBy: String(user.id) }
    return { owner, file, reference: file }
  }
  return { owner, file: null, reference: owner.collection?.receipt || null }
}

function preparedReceipt(candidate, stored) {
  if (candidate.file) {
    if (stored) throw fail('Este comprobante ya está registrado. Seleccioná el archivo nuevamente.', 409)
    return { receipt: receiptMetadata(candidate.file), receiptUploaded: true, file: candidate.file }
  }
  if (!candidate.reference) return { receipt: null, receiptUploaded: false, file: null }
  if (!verifiedReceipt(stored, candidate.reference)) throw fail('El comprobante asociado no está disponible. Adjuntalo nuevamente para continuar.', 409)
  return { receipt: receiptMetadata(stored), receiptUploaded: false, file: null }
}

async function prepareCollectionReceipt(state, input, user, store, now = new Date().toISOString()) {
  const candidate = receiptCandidate(state, input, user, now, await domain)
  return preparedReceipt(candidate, candidate.reference ? await store.get(candidate.owner.id, candidate.reference.id) : null)
}

// SQLite shares one connection between requests. Do not yield to another
// request while BEGIN IMMEDIATE is active; import the domain before BEGIN.
function prepareCollectionReceiptSync(state, input, user, store, now, helpers) {
  const candidate = receiptCandidate(state, input, user, now, helpers)
  return preparedReceipt(candidate, candidate.reference ? store.get(candidate.owner.id, candidate.reference.id) : null)
}

async function handleCollectionReceipt({ req, res, state, user, recordId, receiptId, store }) {
  if (req.method !== 'GET') throw fail('Los comprobantes se conservan con la cobranza y no se pueden eliminar.', 405)
  const owner = receiptOwner(state, recordId, user, false, await domain)
  const active = owner.collection?.receipt
  const reference = active?.id === receiptId ? active : (owner.collection?.receipts || []).find(file => file.id === receiptId)
  if (!reference) throw fail('El comprobante no pertenece a esta cobranza.', 404)
  if (active?.id !== receiptId && !permissions.can(user, 'collections.timeline')) throw fail('No tenés permiso para consultar versiones anteriores del comprobante.', 403)
  await store.ensure()
  const file = await store.get(owner.id, receiptId)
  if (!verifiedReceipt(file, reference)) throw fail('El comprobante no está disponible.', 404)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', file.bytes)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
  res.statusCode = 200
  res.end(file.data)
}

module.exports = { prepareCollectionReceipt, prepareCollectionReceiptSync, handleCollectionReceipt, receiptMetadata }
