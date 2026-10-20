const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { prepareCollectionReceipt, prepareCollectionReceiptSync, handleCollectionReceipt } = require('../api/_lib/collection-receipts.cjs')
const { sqliteCollectionReceiptStore, postgresCollectionReceiptStore } = require('../api/_lib/collection-receipt-store.cjs')
const { handleAttachments } = require('../api/_lib/attachments.cjs')
const { assertCompletedServices } = require('../api/_lib/completed-service-policy.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const domain = import('../src/domain/collections/collections.mjs')
const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const now = '2026-10-21T12:00:00.000Z'
const upload = (id = 'receipt-original-000001', text = 'verified payment') => ({
  id, name: '../Comprobante.pdf',
  data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.7\n${text}`).toString('base64')}`
})
const fixture = () => ({
  history: [{ id: 'payment', date: '2026-10-20', status: 'Completado', amount: '10000', paymentMethod: 'Transferencia', technicianIds: ['tech'] }],
  customers: [], agenda: { teams: [], weekly: {} }
})
const userWith = (...permissions) => ({ id: 'tech', name: 'Colaborador', roleCode: 'custom', permissions: { __catalogV2: true, ...Object.fromEntries(permissions.map(key => [key, true])) } })
const reader = (...permissions) => userWith('collections.view', 'records.financial', 'scope.services.read.all', ...permissions)
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value }, end(body) { this.body = body } })

async function command(state, patch = {}) {
  const { collectionBase } = await domain
  const record = state.history[0]
  return { action: 'confirm', recordId: record.id, base: collectionBase(record), amount: record.amount, paymentMethod: record.paymentMethod, ...patch }
}
async function database() {
  const db = new DatabaseSync(':memory:')
  const store = sqliteCollectionReceiptStore(db)
  store.ensure()
  db.exec('CREATE TABLE collection_state (id INTEGER PRIMARY KEY, data TEXT); CREATE TABLE collection_audit (data TEXT)')
  return { db, store }
}
async function save(db, store, state, input, user = admin, failAfterFile = false) {
  const helpers = await domain
  db.exec('BEGIN IMMEDIATE')
  try {
    const prepared = prepareCollectionReceiptSync(state, input, user, store, now, helpers)
    const result = helpers.manageCollection(state, input, user, now, prepared)
    if (prepared.file) store.put(result.before.id, prepared.file)
    if (failAfterFile) throw new Error('forced state failure')
    db.prepare('INSERT OR REPLACE INTO collection_state VALUES (1,?)').run(JSON.stringify(result.state))
    db.prepare('INSERT INTO collection_audit VALUES (?)').run(JSON.stringify(result.after.collection.events.at(-1)))
    db.exec('COMMIT')
    return result
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

test('non-cash confirmation requires server evidence, while cash stays optional and client flags cannot bypass it', async () => {
  const { manageCollection } = await domain
  const state = fixture()
  for (const paymentMethod of ['Transferencia', 'Débito', 'Crédito']) {
    const input = await command(state, { paymentMethod })
    assert.throws(() => manageCollection(state, input, admin), /Adjuntá el comprobante/)
    assert.throws(() => manageCollection(state, { ...input, receipt: { id: 'fake', exists: true }, receiptUploaded: true, hasReceipt: true }, admin), /Adjuntá el comprobante/)
  }
  const result = manageCollection(state, await command(state, { paymentMethod: 'Efectivo' }), admin)
  assert.equal(result.after.collection.status, 'confirmed')
  assert.equal(result.after.collection.receipt, undefined)
})

test('validated upload commits bytes, receipt metadata and confirmation without binary data in state or audit', async () => {
  const { db, store } = await database()
  try {
    const state = fixture(), input = await command(state, { receipt: upload() })
    const original = structuredClone(state)
    const result = await save(db, store, state, input)
    assert.deepEqual(state, original)
    const receipt = result.after.collection.receipt
    assert.equal(receipt.name, '.._Comprobante.pdf')
    assert.equal(receipt.uploadedBy, admin.id)
    assert.equal(receipt.createdAt, now)
    assert.equal(receipt.mime, 'application/pdf')
    assert.deepEqual(result.after.collection.receipts, [receipt])
    assert.equal(receipt.data, undefined)
    assert.equal(store.get('payment', receipt.id).data.toString(), '%PDF-1.7\nverified payment')
    assert.equal(store.get('other', receipt.id), undefined)
    assert.equal(db.prepare('SELECT count(*) AS total FROM collection_audit').get().total, 1)
    assert.equal(JSON.stringify(result.state).includes('base64'), false)
    const prepared = await prepareCollectionReceipt(result.state, await command(result.state, { action: 'correct', amount: '11000' }), admin, store, now)
    assert.equal(prepared.receiptUploaded, false)
    assert.deepEqual(prepared.receipt, receipt)
  } finally { db.close() }
})

test('invalid uploads and duplicate identifiers do not change the stored collection or its evidence', async () => {
  const { db, store } = await database()
  try {
    const state = fixture()
    const bad = [
      { ...upload(), data: 'data:application/pdf;base64,YmFk' },
      { ...upload(), data: 'data:text/html;base64,PGh0bWw+' },
      { id: 'receipt-fake-000001', name: 'fake.pdf', digest: 'a'.repeat(64), bytes: 12 },
      { ...upload(), id: '../wrong' },
      { ...upload(), data: `data:application/pdf;base64,${Buffer.alloc(3_000_001, 65).toString('base64')}` }
    ]
    for (const receipt of bad) await assert.rejects(save(db, store, state, await command(state, { receipt })), /adjunto|imagen|PDF|archivo/i)
    assert.equal(db.prepare('SELECT count(*) AS total FROM attachments').get().total, 0)
    const first = await save(db, store, state, await command(state, { receipt: upload() }))
    const replace = await command(first.state, { action: 'receipt', receipt: upload() })
    await assert.rejects(save(db, store, first.state, replace), { statusCode: 409 })
    assert.equal(db.prepare('SELECT count(*) AS total FROM attachments').get().total, 1)
  } finally { db.close() }
})

test('SQLite rolls back file insertion when subsequent state or audit persistence fails', async () => {
  const { db, store } = await database()
  try {
    const state = fixture(), input = await command(state, { receipt: upload() })
    await assert.rejects(save(db, store, state, input, admin, true), /forced state failure/)
    assert.equal(db.prepare('SELECT count(*) AS total FROM attachments').get().total, 0)
    assert.equal(db.prepare('SELECT count(*) AS total FROM collection_state').get().total, 0)
    assert.equal(db.prepare('SELECT count(*) AS total FROM collection_audit').get().total, 0)
    await save(db, store, state, input)
    assert.equal(db.prepare('SELECT count(*) AS total FROM attachments').get().total, 1)
  } finally { db.close() }
})

test('historical replacement preserves confirmation time, previous files, audit and unrelated journey fields', async () => {
  const { db, store } = await database()
  try {
    const state = fixture()
    state.history[0].serviceJourney = { id: 'payment', index: 1, total: 2 }
    state.history.push({ ...state.history[0], id: 'visit-2', date: '2026-10-21', serviceJourney: { id: 'payment', index: 2, total: 2 } })
    const first = await save(db, store, state, await command(state, { receipt: upload() }))
    assert.equal(first.state.history[1].collection, undefined)
    const replacement = await save(db, store, first.state, await command(first.state, { action: 'receipt', receipt: upload('receipt-replacement-000002', 'replacement') }))
    assert.equal(replacement.after.collection.confirmedAt, first.after.collection.confirmedAt)
    assert.deepEqual(replacement.after.collection.confirmedBy, first.after.collection.confirmedBy)
    assert.equal(replacement.after.amount, first.after.amount)
    assert.equal(replacement.after.paymentMethod, first.after.paymentMethod)
    assert.deepEqual(replacement.recordIds, ['payment'])
    assert.deepEqual(replacement.state.history[1], first.state.history[1])
    assert.deepEqual(replacement.after.collection.receipts.map(file => file.id), ['receipt-original-000001', 'receipt-replacement-000002'])
    assert.equal(replacement.after.collection.events.at(-1).receiptBefore, 'receipt-original-000001')
    assert.equal(replacement.after.collection.events.at(-1).receiptAfter, 'receipt-replacement-000002')
    assert.ok(store.get('payment', 'receipt-original-000001'))
    assert.ok(store.get('payment', 'receipt-replacement-000002'))
    const stale = await command(first.state, { action: 'receipt', receipt: upload('receipt-stale-000003') })
    await assert.rejects(save(db, store, replacement.state, stale), { statusCode: 409 })
    assert.equal(store.get('payment', 'receipt-stale-000003'), undefined)
    const sibling = await command(replacement.state, { recordId: 'visit-2', receipt: upload('receipt-sibling-000004') })
    await assert.rejects(save(db, store, replacement.state, sibling), { statusCode: 404 })
  } finally { db.close() }
})

test('historical confirmed payments remain valid; changing a confirmed non-cash method requires a new file', async () => {
  const { db, store } = await database()
  try {
    const state = fixture()
    state.history[0].collection = { status: 'confirmed', confirmedAt: '2026-10-15T10:00:00Z', confirmedBy: { id: 'old', name: 'Anterior' } }
    const corrected = await save(db, store, state, await command(state, { action: 'correct', amount: '11000' }))
    assert.equal(corrected.after.collection.receipt, undefined)
    assert.equal(corrected.after.collection.confirmedAt, '2026-10-15T10:00:00Z')
    await assert.rejects(save(db, store, corrected.state, await command(corrected.state, { action: 'correct', paymentMethod: 'Débito' })), /nuevo comprobante/)
    const backed = await save(db, store, corrected.state, await command(corrected.state, { action: 'receipt', receipt: upload() }))
    await assert.rejects(save(db, store, backed.state, await command(backed.state, { action: 'correct', paymentMethod: 'Débito' })), /nuevo comprobante/)
    const method = await save(db, store, backed.state, await command(backed.state, { action: 'correct', paymentMethod: 'Débito', receipt: upload('receipt-debit-000002') }))
    assert.equal(method.after.paymentMethod, 'Débito')
    const cash = await save(db, store, method.state, await command(method.state, { action: 'correct', paymentMethod: 'Efectivo' }))
    assert.equal(cash.after.collection.receipts.length, 2)
    await assert.rejects(save(db, store, cash.state, await command(cash.state, { action: 'correct', paymentMethod: 'Crédito' })), /nuevo comprobante/)
  } finally { db.close() }
})

test('receipt-only action cannot confirm a pending payment or silently change its financial terms', async () => {
  const { db, store } = await database()
  try {
    const state = fixture()
    await assert.rejects(save(db, store, state, await command(state, { action: 'receipt', receipt: upload() })), /confirmada/)
    const paid = await save(db, store, state, await command(state, { receipt: upload() }))
    await assert.rejects(save(db, store, paid.state, await command(paid.state, { action: 'receipt' })), /Seleccioná/)
    await assert.rejects(save(db, store, paid.state, await command(paid.state, { action: 'receipt', amount: '12000', receipt: upload('receipt-extra-000002') })), /rectificación/)
    assert.equal(db.prepare('SELECT count(*) AS total FROM attachments').get().total, 1)
  } finally { db.close() }
})

test('receipt reads require financial collection access and historical versions additionally require timeline', async () => {
  const { db, store } = await database()
  try {
    const state = fixture()
    const first = await save(db, store, state, await command(state, { receipt: upload() }))
    const latest = await save(db, store, first.state, await command(first.state, { action: 'receipt', receipt: upload('receipt-latest-000002') }))
    const args = { req: { method: 'GET' }, state: latest.state, user: reader(), recordId: 'payment', receiptId: 'receipt-latest-000002', store }
    const res = response()
    await handleCollectionReceipt({ ...args, res })
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Cache-Control'], 'private, no-store')
    assert.ok(Buffer.isBuffer(res.body))
    await assert.rejects(handleCollectionReceipt({ ...args, res: response(), receiptId: 'receipt-original-000001' }), { statusCode: 403 })
    await handleCollectionReceipt({ ...args, res: response(), user: reader('collections.timeline'), receiptId: 'receipt-original-000001' })
    for (const user of [
      userWith('collections.view', 'scope.services.read.all'),
      userWith('records.financial', 'history.view', 'records.read', 'service.documents.read', 'scope.services.read.all'),
      { id: 'tech', roleCode: 'technician' },
      { id: 'old', roleCode: 'custom', permissions: { history: true } }
    ]) await assert.rejects(handleCollectionReceipt({ ...args, res: response(), user }), { statusCode: 403 })
    await assert.rejects(handleCollectionReceipt({ ...args, res: response(), receiptId: 'receipt-other-000003' }), { statusCode: 404 })
    await assert.rejects(handleCollectionReceipt({ ...args, res: response(), req: { method: 'DELETE' }, user: admin }), { statusCode: 405 })
  } finally { db.close() }
})

test('scoped receipt access checks both the owner and the first effective journey, including upload permission', async () => {
  const { db, store } = await database()
  try {
    const state = fixture()
    state.history[0].status = 'Cancelado'
    state.history[0].serviceJourney = { id: 'payment', index: 1, total: 2 }
    state.history.push({ ...state.history[0], id: 'visit-2', date: '2026-10-21', status: 'Pendiente', technicianIds: ['other'], serviceJourney: { id: 'payment', index: 2, total: 2 } })
    const scoped = userWith('collections.view', 'records.financial', 'collections.confirm', 'scope.services.read.assigned', 'scope.services.write.assigned')
    await assert.rejects(save(db, store, state, await command(state, { receipt: upload() }), scoped), { statusCode: 403 })
    const paid = await save(db, store, state, await command(state, { receipt: upload() }))
    await assert.rejects(handleCollectionReceipt({ req: { method: 'GET' }, res: response(), state: paid.state, user: scoped, recordId: 'payment', receiptId: 'receipt-original-000001', store }), { statusCode: 403 })
    const noConfirm = reader('collections.method', 'scope.services.write.all')
    await assert.rejects(prepareCollectionReceipt(paid.state, await command(paid.state, { action: 'receipt', receipt: upload('receipt-forbidden-000002') }), noConfirm, store, now), { statusCode: 403 })
  } finally { db.close() }
})

test('missing or corrupted stored receipt cannot be reused, and general attachment/state routes cannot remove evidence', async () => {
  const { db, store } = await database()
  try {
    const state = fixture()
    const paid = await save(db, store, state, await command(state, { receipt: upload() }))
    const correction = await command(paid.state, { action: 'correct', amount: '11000' })
    db.prepare("UPDATE attachments SET content=? WHERE scope='collection'").run(Buffer.from('corrupt'))
    await assert.rejects(prepareCollectionReceipt(paid.state, correction, admin, store, now), { statusCode: 409 })
    db.prepare("DELETE FROM attachments WHERE scope='collection'").run()
    await assert.rejects(prepareCollectionReceipt(paid.state, correction, admin, store, now), { statusCode: 409 })
    await assert.rejects(handleAttachments({ req: { method: 'DELETE' }, res: response(), user: admin, scope: 'collection', entityId: 'payment', attachmentId: 'receipt-original-000001', entity: paid.after, store }), /Destino/)
    const wiped = structuredClone(paid.state)
    delete wiped.history[0].collection.receipt
    assert.throws(() => assertCompletedServices(wiped, paid.state), { code: 'COLLECTION_PROTECTED' })
    const repaired = await save(db, store, paid.state, await command(paid.state, { action: 'receipt', receipt: upload('receipt-repaired-000002') }))
    assert.equal(repaired.after.collection.receipt.id, 'receipt-repaired-000002')
  } finally { db.close() }
})

test('Postgres receipt storage shares its caller transaction and preserves binary evidence after rollback and replacement', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  const sql = pgliteAdapter(pg)
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE receipt_state (id integer primary key, data jsonb);')
    await postgresCollectionReceiptStore(sql).ensure()
    const state = fixture(), input = await command(state, { receipt: upload() })
    const { manageCollection } = await domain
    const transaction = async (failAfterFile = false) => sql.begin(async tx => {
      const store = postgresCollectionReceiptStore(tx)
      const prepared = await prepareCollectionReceipt(state, input, admin, store, now)
      const result = manageCollection(state, input, admin, now, prepared)
      await store.put(result.before.id, prepared.file)
      if (failAfterFile) throw new Error('forced state failure')
      await tx`insert into receipt_state values(1,${JSON.stringify(result.state)})`
      return result
    })
    await assert.rejects(transaction(true), /forced state failure/)
    assert.equal((await pg.query('SELECT count(*)::integer AS total FROM pignus_attachments')).rows[0].total, 0)
    assert.equal((await pg.query('SELECT count(*)::integer AS total FROM receipt_state')).rows[0].total, 0)
    const result = await transaction()
    const stored = await postgresCollectionReceiptStore(sql).get('payment', result.after.collection.receipt.id)
    assert.equal(stored.data.toString(), '%PDF-1.7\nverified payment')
    assert.deepEqual(result.after.collection.receipt.createdAt, stored.createdAt)
    await assert.rejects(sql.begin(tx => postgresCollectionReceiptStore(tx).put('payment', stored)), { statusCode: 409 })
    assert.equal((await pg.query('SELECT count(*)::integer AS total FROM pignus_attachments')).rows[0].total, 1)
  } finally { await pg.close() }
})
