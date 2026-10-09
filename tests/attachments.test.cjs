const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { decodeAttachment, handleAttachments, attachmentAccess } = require('../api/_lib/attachments.cjs')
const { sqliteAttachmentStore } = require('../api/_lib/attachment-store.cjs')
const file = id => ({ id: id || 'attachment-00000001', name: 'documento.pdf', data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nexample').toString('base64') })
test('technical uploads reject PDFs and file-origin images even for assigned vehicle controls', async () => {
  let added = 0
  const args = { req: { method: 'POST' }, res: { setHeader() {}, end() {} }, user: { id: 'tech', roleCode: 'technician' }, scope: 'service', entityId: 'control', entity: { vehicleControl: true, technicianIds: ['tech'] }, store: { ensure() {}, add() { added++ } } }
  await assert.rejects(handleAttachments({ ...args, body: { ...file(), source: 'camera' } }), error => error.statusCode === 403)
  const photo = { ...file(), name: 'foto.jpg', data: 'data:image/jpeg;base64,/9j/AA==' }
  await assert.rejects(handleAttachments({ ...args, body: { ...photo, source: 'file' } }), error => error.statusCode === 403)
  await handleAttachments({ ...args, body: { ...photo, source: 'camera' } })
  assert.equal(added, 1)
  await assert.rejects(handleAttachments({ ...args, entity: { technicianIds: ['tech'] }, body: { ...photo, source: 'camera' } }), error => error.statusCode === 403)
})
test('camera-only picker exposes no gallery or file input', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { AttachmentDraftField } = require('./helpers/load-app.cjs')(['AttachmentDraftField'])
  const markup = renderToStaticMarkup(React.createElement(AttachmentDraftField, { cameraOnly: true, files: [], onChange() {} }))
  assert.doesNotMatch(markup, /type="file"|Agregar archivos/)
  assert.match(markup, /Sacar foto/)
})
test('multiple attachments accumulate, retries are idempotent and removal is individual', async () => {
  const db = new DatabaseSync(':memory:'), store = sqliteAttachmentStore(db)
  store.ensure()
  const one = { ...decodeAttachment(file()), uploadedBy: 'a' }, two = { ...decodeAttachment(file('attachment-00000002')), uploadedBy: 'a' }
  store.add('service', 'job', one); store.add('service', 'job', two); store.add('service', 'job', one)
  assert.equal(store.list('service', 'job').length, 2)
  assert.equal(store.list('service', 'other').length, 0)
  assert.equal(store.list('service', 'job')[0].data, undefined)
  store.remove('service', 'job', one.id)
  assert.equal(store.list('service', 'job')[0].id, two.id)
  assert.deepEqual(Buffer.from(store.content('service', 'job', two.id)), two.data)
  for (let i = 0; i < 19; i++) store.add('service', 'job', { ...one, id: `attachment-more-${i}` })
  assert.throws(() => store.add('service', 'job', one), /20 adjuntos/)
  db.close()
})
test('rejects other types, invalid contents and oversized data', () => {
  for (const data of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/jpeg;base64,SGVsbG8=', 'data:application/pdf;base64,' + 'A'.repeat(4_000_004)]) {
    assert.throws(() => decodeAttachment({ ...file(), data }), /válid|imagen|PDF/)
  }
  assert.equal(decodeAttachment({ ...file(), name: '../x\r\n.pdf' }).name.includes('\n'), false)
})
test('attachment permissions preserve roles and technician assignment', () => {
  const entity = { technicianIds: ['tech'] }
  assert.deepEqual(attachmentAccess({ id: 'other', roleCode: 'technician' }, 'service', entity), { read: false, write: false })
  assert.deepEqual(attachmentAccess({ id: 'tech', roleCode: 'technician' }, 'service', entity), { read: true, write: false })
  assert.equal(attachmentAccess({ id: 'tech', roleCode: 'technician' }, 'service', { ...entity, vehicleControl: true }).write, true)
  assert.equal(attachmentAccess({ roleCode: 'operator' }, 'service', entity).write, false)
  assert.equal(attachmentAccess({ roleCode: 'technician' }, 'vehicle', {}).write, false)
})
test('authorized cached downloads avoid binary reads; technicians cannot delete another uploader file', async () => {
  const db = new DatabaseSync(':memory:'), store = sqliteAttachmentStore(db)
  store.ensure()
  const item = { ...decodeAttachment(file()), uploadedBy: 'admin' }
  store.add('service', 'job', item)
  const res = { setHeader() {}, end() {} }
  const args = { req: { method: 'GET', headers: { 'if-none-match': `"${item.digest}"` } }, res, user: { id: 'tech', roleCode: 'technician' }, scope: 'service', entityId: 'job', attachmentId: item.id, entity: { technicianIds: ['tech'] }, store: { ...store, content: () => { throw new Error('Binary fetched unnecessarily') } } }
  await handleAttachments(args)
  assert.equal(res.statusCode, 304)
  await assert.rejects(handleAttachments({ ...args, req: { method: 'DELETE' } }), error => error.statusCode === 403)
  await assert.rejects(handleAttachments({ ...args, user: { id: 'other', roleCode: 'technician' } }), error => error.statusCode === 403)
  assert.equal(store.list('service', 'job').length, 1)
  db.close()
})
