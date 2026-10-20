const { fail } = require('./attachments.cjs')
const { postgresAttachmentStore, sqliteAttachmentStore } = require('./attachment-store.cjs')
const metadata = row => row && ({
  id: row.id, name: row.file_name, mime: row.mime_type, bytes: Number(row.byte_size), digest: row.digest,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  uploadedBy: row.uploaded_by, data: Buffer.from(row.content)
})

// Call ensure on the root connection before the collection transaction. get/put
// use the caller's connection directly so bytes and state commit or roll back
// together; these stores deliberately expose no delete or overwrite operation.
function postgresCollectionReceiptStore(sql) {
  return {
    ensure: () => postgresAttachmentStore(sql).ensure(),
    get: async (ownerId, receiptId) => metadata((await sql`select id,file_name,mime_type,byte_size,digest,created_at,uploaded_by,content from pignus_attachments where scope='collection' and entity_id=${String(ownerId)} and id=${receiptId}`)[0]),
    put: async (ownerId, file) => {
      const result = await sql`insert into pignus_attachments(scope,entity_id,id,file_name,mime_type,byte_size,digest,content,created_at,uploaded_by) values('collection',${String(ownerId)},${file.id},${file.name},${file.mime},${file.bytes},${file.digest},${file.data},${file.createdAt},${file.uploadedBy}) on conflict(scope,entity_id,id) do nothing returning id`
      if (!result.length) throw fail('El identificador del comprobante ya está registrado. Seleccioná el archivo nuevamente.', 409)
    }
  }
}

function sqliteCollectionReceiptStore(db) {
  return {
    ensure: () => sqliteAttachmentStore(db).ensure(),
    get: (ownerId, receiptId) => metadata(db.prepare("SELECT id,file_name,mime_type,byte_size,digest,created_at,uploaded_by,content FROM attachments WHERE scope='collection' AND entity_id=? AND id=?").get(String(ownerId), receiptId)),
    put: (ownerId, file) => {
      const result = db.prepare("INSERT INTO attachments(scope,entity_id,id,file_name,mime_type,byte_size,digest,content,created_at,uploaded_by) VALUES('collection',?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,entity_id,id) DO NOTHING").run(String(ownerId),file.id,file.name,file.mime,file.bytes,file.digest,file.data,file.createdAt,file.uploadedBy)
      if (!result.changes) throw fail('El identificador del comprobante ya está registrado. Seleccioná el archivo nuevamente.', 409)
    }
  }
}

module.exports = { postgresCollectionReceiptStore, sqliteCollectionReceiptStore }
