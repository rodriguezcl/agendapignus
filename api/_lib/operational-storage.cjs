async function queryRows(sql, statement, parameters = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, parameters) : await sql.unsafe(statement, parameters)
  return result.rows || result
}

async function normalizedShadowIsPrepared(sql) {
  const [catalog] = await queryRows(sql, "select to_regclass('normalized_shadow.import_batch') as import_batch")
  if (!catalog?.import_batch) return false
  const [batch] = await queryRows(sql, 'select id from normalized_shadow.import_batch where id = 1')
  return Boolean(batch)
}

async function appendOperationalAudit(sql, entries, { shadowPrepared = false } = {}) {
  if (!entries.length) return
  // One round trip per model, rather than one per event while holding the
  // state revision lock. Preserve first-write legacy / last-write shadow semantics.
  const first = new Map(), last = new Map()
  for (const event of entries) {
    const id = String(event.id)
    if (!first.has(id)) first.set(id, event)
    last.set(id, event)
  }
  await queryRows(sql, `insert into pignus_audit_log (id, occurred_at, data)
    select (event->>'id')::uuid, (event->>'at')::timestamptz, event
    from jsonb_array_elements($1::jsonb) as item(event)
    on conflict (id) do nothing`, [JSON.stringify([...first.values()])])
  await queryRows(sql, 'delete from pignus_audit_log where id in (select id from pignus_audit_log order by occurred_at desc offset 100)')
  if (!shadowPrepared && !(await normalizedShadowIsPrepared(sql))) return
  await queryRows(sql, `insert into normalized_shadow.audit_events
    (id, occurred_at, actor_employee_id, actor_name, actor_email, actor_role, action, entity, entity_id, before_payload, after_payload, original_payload)
    select (event->>'id')::uuid, (event->>'at')::timestamptz,
      event->'user'->>'id', nullif(event->'user'->>'name', ''), nullif(event->'user'->>'email', ''),
      nullif(event->'user'->>'role', ''), event->>'action', event->>'entity', event->>'entityId',
      nullif(event->'before', 'null'::jsonb), nullif(event->'after', 'null'::jsonb), event
    from jsonb_array_elements($1::jsonb) as item(event)
    on conflict (id) do update set occurred_at=excluded.occurred_at, actor_employee_id=excluded.actor_employee_id,
      actor_name=excluded.actor_name, actor_email=excluded.actor_email, actor_role=excluded.actor_role,
      action=excluded.action, entity=excluded.entity, entity_id=excluded.entity_id,
      before_payload=excluded.before_payload, after_payload=excluded.after_payload, original_payload=excluded.original_payload`,
    [JSON.stringify([...last.values()])])
  await queryRows(sql, 'delete from normalized_shadow.audit_events where id in (select id from normalized_shadow.audit_events order by occurred_at desc offset 100)')
}

async function upsertVehicleInsuranceDocument(sql, document) {
  await queryRows(sql, `insert into pignus_vehicle_insurance_documents (vehicle_id, file_name, pdf_data, uploaded_at)
    values ($1,$2,$3,$4) on conflict (vehicle_id) do update set file_name=excluded.file_name, pdf_data=excluded.pdf_data, uploaded_at=excluded.uploaded_at`,
  [String(document.vehicleId), document.fileName, document.data, document.uploadedAt])
  if (!(await normalizedShadowIsPrepared(sql))) return
  await queryRows(sql, `insert into normalized_shadow.vehicle_insurance_documents (vehicle_id, file_name, pdf_data, uploaded_at)
    values ($1,$2,$3,$4) on conflict (vehicle_id) do update set file_name=excluded.file_name, pdf_data=excluded.pdf_data, uploaded_at=excluded.uploaded_at`,
  [String(document.vehicleId), document.fileName, document.data, document.uploadedAt])
}

async function upsertVehicleControlPhoto(sql, photo) {
  await queryRows(sql, `insert into pignus_vehicle_control_photos (record_id, vehicle_id, mime_type, photo_data, created_at)
    values ($1,$2,$3,$4,$5) on conflict (record_id) do update set vehicle_id=excluded.vehicle_id, mime_type=excluded.mime_type,
    photo_data=excluded.photo_data, created_at=excluded.created_at`,
  [String(photo.recordId), String(photo.vehicleId), photo.mimeType, photo.data, photo.createdAt])
  if (!(await normalizedShadowIsPrepared(sql))) return
  await queryRows(sql, `insert into normalized_shadow.vehicle_control_photos (job_id, vehicle_id, mime_type, photo_data, created_at)
    values ($1,$2,$3,$4,$5) on conflict (job_id) do update set vehicle_id=excluded.vehicle_id, mime_type=excluded.mime_type,
    photo_data=excluded.photo_data, created_at=excluded.created_at`,
  [String(photo.recordId), String(photo.vehicleId), photo.mimeType, photo.data, photo.createdAt])
}

async function upsertServicePhoto(sql, photo) {
  await queryRows(sql, `insert into pignus_service_photos (record_id, mime_type, photo_data, created_at, uploaded_by_id, uploaded_by_name)
    values ($1,$2,$3,$4,$5,$6) on conflict (record_id) do update set mime_type=excluded.mime_type,
    photo_data=excluded.photo_data, created_at=excluded.created_at, uploaded_by_id=excluded.uploaded_by_id, uploaded_by_name=excluded.uploaded_by_name`,
  [String(photo.recordId), photo.mimeType, photo.data, photo.createdAt, photo.uploadedById == null ? null : String(photo.uploadedById), photo.uploadedByName || null])
  if (!(await normalizedShadowIsPrepared(sql))) return
  await queryRows(sql, `create table if not exists normalized_shadow.service_photos (
    job_id text primary key references normalized_shadow.jobs(id) on delete cascade,
    mime_type text not null, photo_data bytea not null, created_at timestamptz not null,
    uploaded_by_id text, uploaded_by_name text
  )`)
  await queryRows(sql, `insert into normalized_shadow.service_photos (job_id, mime_type, photo_data, created_at, uploaded_by_id, uploaded_by_name)
    values ($1,$2,$3,$4,$5,$6) on conflict (job_id) do update set mime_type=excluded.mime_type,
    photo_data=excluded.photo_data, created_at=excluded.created_at, uploaded_by_id=excluded.uploaded_by_id, uploaded_by_name=excluded.uploaded_by_name`,
  [String(photo.recordId), photo.mimeType, photo.data, photo.createdAt, photo.uploadedById == null ? null : String(photo.uploadedById), photo.uploadedByName || null])
}

async function deleteServicePhoto(sql, recordId) {
  await queryRows(sql, 'delete from pignus_service_photos where record_id = $1', [String(recordId)])
  if (!(await normalizedShadowIsPrepared(sql))) return
  await queryRows(sql, 'delete from normalized_shadow.service_photos where job_id = $1', [String(recordId)])
}

async function setAuxiliaryPreference(sql, key, value) {
  if (value == null) await queryRows(sql, 'delete from pignus_preferences where key = $1', [key])
  else await queryRows(sql, `insert into pignus_preferences (key, value, updated_at) values ($1,$2,now())
    on conflict (key) do update set value=excluded.value, updated_at=now()`, [key, value])
  if (!(await normalizedShadowIsPrepared(sql))) return
  if (value == null) await queryRows(sql, 'delete from normalized_shadow.legacy_preference_evidence where preference_key = $1', [key])
  else await queryRows(sql, `insert into normalized_shadow.legacy_preference_evidence (preference_key, preference_value, updated_at)
    values ($1,$2,now()) on conflict (preference_key) do update set preference_value=excluded.preference_value, updated_at=now()`, [key, value])
}

module.exports = { appendOperationalAudit, deleteServicePhoto, normalizedShadowIsPrepared, setAuxiliaryPreference, upsertServicePhoto, upsertVehicleControlPhoto, upsertVehicleInsuranceDocument }
