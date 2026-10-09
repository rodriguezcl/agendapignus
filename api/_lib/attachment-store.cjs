const { MAX_FILES, fail } = require('./attachments.cjs')
const metadata = row => ({ id: row.id, name: row.file_name, mime: row.mime_type, bytes: Number(row.byte_size), digest: row.digest, createdAt: row.created_at, uploadedBy: row.uploaded_by })
let schemaReady
function postgresAttachmentStore(sql) {
  const ensure = async () => {
    if (!schemaReady) schemaReady = sql.begin(async tx => {
      await tx`create table if not exists pignus_attachments (scope text not null, entity_id text not null, id text not null, file_name text not null, mime_type text not null, byte_size integer not null, digest text not null, content bytea not null, created_at timestamptz not null, uploaded_by text not null, primary key(scope, entity_id, id))`
      await tx`alter table pignus_attachments enable row level security`
      await tx`revoke all on table pignus_attachments from anon, authenticated`
    }).catch(error => { schemaReady = null; throw error })
    await schemaReady
  }
  return { ensure,
    list: async (scope, entity) => (await sql`select id,file_name,mime_type,byte_size,digest,created_at,uploaded_by from pignus_attachments where scope=${scope} and entity_id=${entity} order by created_at,id`).map(metadata),
    add: (scope, entity, f) => sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${scope + ':' + entity}, 0))`
      const existing = await tx`select id,digest from pignus_attachments where scope=${scope} and entity_id=${entity}`
      const same = existing.find(row => row.id === f.id)
      if (same) { if (same.digest !== f.digest) throw fail('El identificador pertenece a otro archivo.', 409); return }
      if (existing.length >= MAX_FILES) throw fail(`Se permiten hasta ${MAX_FILES} adjuntos por registro.`)
      await tx`insert into pignus_attachments(scope,entity_id,id,file_name,mime_type,byte_size,digest,content,created_at,uploaded_by) values(${scope},${entity},${f.id},${f.name},${f.mime},${f.bytes},${f.digest},${f.data},${f.createdAt},${f.uploadedBy})`
    }),
    remove: (scope, entity, id) => sql`delete from pignus_attachments where scope=${scope} and entity_id=${entity} and id=${id}`,
    content: async (scope, entity, id) => (await sql`select content from pignus_attachments where scope=${scope} and entity_id=${entity} and id=${id}`)[0]?.content
  }
}
function sqliteAttachmentStore(db) {
  return {
    ensure: () => db.exec('CREATE TABLE IF NOT EXISTS attachments (scope TEXT NOT NULL,entity_id TEXT NOT NULL,id TEXT NOT NULL,file_name TEXT NOT NULL,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,digest TEXT NOT NULL,content BLOB NOT NULL,created_at TEXT NOT NULL,uploaded_by TEXT NOT NULL,PRIMARY KEY(scope,entity_id,id))'),
    list: (scope, entity) => db.prepare('SELECT id,file_name,mime_type,byte_size,digest,created_at,uploaded_by FROM attachments WHERE scope=? AND entity_id=? ORDER BY created_at,id').all(scope, entity).map(metadata),
    add: (scope, entity, f) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const existing = db.prepare('SELECT id,digest FROM attachments WHERE scope=? AND entity_id=?').all(scope, entity)
        const same = existing.find(row => row.id === f.id)
        if (same && same.digest !== f.digest) throw fail('El identificador pertenece a otro archivo.', 409)
        if (!same) {
          if (existing.length >= MAX_FILES) throw fail(`Se permiten hasta ${MAX_FILES} adjuntos por registro.`)
          db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?,?)').run(scope,entity,f.id,f.name,f.mime,f.bytes,f.digest,f.data,f.createdAt,f.uploadedBy)
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    remove: (scope, entity, id) => db.prepare('DELETE FROM attachments WHERE scope=? AND entity_id=? AND id=?').run(scope,entity,id),
    content: (scope, entity, id) => db.prepare('SELECT content FROM attachments WHERE scope=? AND entity_id=? AND id=?').get(scope,entity,id)?.content
  }
}
module.exports = { postgresAttachmentStore, sqliteAttachmentStore }
