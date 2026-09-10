const crypto = require('node:crypto')
const { fingerprint } = require('./normalization-analysis.cjs')

async function queryRows(sql, statement, parameters = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, parameters) : await sql.unsafe(statement, parameters)
  return result.rows || result
}

function binaryDigest(rows, idKey, dataKey) {
  const digest = crypto.createHash('sha256')
  for (const row of [...rows].sort((a, b) => String(a[idKey]).localeCompare(String(b[idKey]), 'en'))) {
    digest.update(String(row[idKey]))
    digest.update('\0')
    digest.update(crypto.createHash('sha256').update(Buffer.from(row[dataKey])).digest())
  }
  return digest.digest('hex')
}

const isoTimestamp = value => value == null ? null : new Date(value).toISOString()

async function insertPrivilegedDependencies(sql, state, dependencies) {
  const credentials = (state.employees || []).map(employee => {
    if (employee.password && !employee.passwordHash) { const error = new Error('Se detectó una credencial heredada sin hash.'); error.code = 'PLAINTEXT_CREDENTIAL_BLOCKS_CUTOVER'; throw error }
    return employee.passwordHash ? { employeeId: String(employee.id), passwordHash: employee.passwordHash } : null
  }).filter(Boolean)
  for (const item of credentials) await queryRows(sql, 'insert into normalized_shadow.employee_credentials (employee_id, password_hash) values ($1,$2)', [item.employeeId, item.passwordHash])
  for (const row of dependencies.loginAttempts || []) await queryRows(sql, 'insert into normalized_shadow.login_attempts (fingerprint, attempts, blocked_until, updated_at) values ($1,$2,$3,$4)',
    [row.fingerprint, Number(row.attempts), row.blocked_until, row.updated_at])
  for (const row of dependencies.preferences || []) await queryRows(sql, 'insert into normalized_shadow.legacy_preference_evidence (preference_key, preference_value, updated_at) values ($1,$2,$3)',
    [row.key, row.value, row.updated_at])
  for (const row of dependencies.insurance || []) await queryRows(sql, 'insert into normalized_shadow.vehicle_insurance_documents (vehicle_id, file_name, pdf_data, uploaded_at) values ($1,$2,$3,$4)',
    [String(row.vehicle_id), row.file_name, row.pdf_data, row.uploaded_at])
  for (const row of dependencies.photos || []) await queryRows(sql, 'insert into normalized_shadow.vehicle_control_photos (job_id, vehicle_id, mime_type, photo_data, created_at) values ($1,$2,$3,$4,$5)',
    [String(row.record_id), String(row.vehicle_id), row.mime_type, row.photo_data, row.created_at])
  for (const row of dependencies.audit || []) {
    const event = row.data || {}
    await queryRows(sql, 'insert into normalized_shadow.audit_events (id, occurred_at, actor_employee_id, actor_name, actor_email, actor_role, action, entity, entity_id, before_payload, after_payload, original_payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [String(row.id || event.id), row.occurred_at || event.at, event.user?.id == null ? null : String(event.user.id), event.user?.name || null, event.user?.email || null, event.user?.role || null,
        event.action || 'unknown', event.entity || 'unknown', event.entityId == null ? null : String(event.entityId), event.before ?? null, event.after ?? null, event])
  }
  return { credentials }
}

async function verifyPrivilegedDependencies(sql, state, dependencies, inserted) {
  const credentialRows = await queryRows(sql, 'select employee_id, password_hash from normalized_shadow.employee_credentials order by employee_id')
  const loginRows = await queryRows(sql, 'select fingerprint, attempts, blocked_until, updated_at from normalized_shadow.login_attempts order by fingerprint')
  const preferenceRows = await queryRows(sql, 'select preference_key as key, preference_value as value, updated_at from normalized_shadow.legacy_preference_evidence order by preference_key')
  const insuranceRows = await queryRows(sql, 'select vehicle_id, file_name, pdf_data, uploaded_at from normalized_shadow.vehicle_insurance_documents order by vehicle_id')
  const photoRows = await queryRows(sql, 'select job_id as record_id, vehicle_id, mime_type, photo_data, created_at from normalized_shadow.vehicle_control_photos order by job_id')
  const auditRows = await queryRows(sql, 'select original_payload from normalized_shadow.audit_events order by id')
  const sourceAudit = [...(dependencies.audit || [])].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en')).map(row => row.data)
  const credentialsMatch = credentialRows.length === inserted.credentials.length && credentialRows.every((row, index) => row.employee_id === inserted.credentials[index].employeeId && row.password_hash === inserted.credentials[index].passwordHash)
  if (!credentialsMatch) throw Object.assign(new Error('Las credenciales no coinciden en el ensayo.'), { code: 'PHYSICAL_REHEARSAL_MISMATCH' })
  if (loginRows.length !== (dependencies.loginAttempts || []).length) throw Object.assign(new Error('Los bloqueos de acceso no coinciden en el ensayo.'), { code: 'PHYSICAL_REHEARSAL_MISMATCH' })
  const sourcePreferences = [...(dependencies.preferences || [])].sort((a, b) => String(a.key).localeCompare(String(b.key), 'en'))
  const comparablePreferences = rows => rows.map(row => ({ key: row.key, value: row.value, updated_at: isoTimestamp(row.updated_at) }))
  if (fingerprint(comparablePreferences(preferenceRows)) !== fingerprint(comparablePreferences(sourcePreferences))) throw Object.assign(new Error('Las preferencias auxiliares no coinciden en el ensayo.'), { code: 'PHYSICAL_REHEARSAL_MISMATCH' })
  if (fingerprint(auditRows.map(row => row.original_payload)) !== fingerprint(sourceAudit)) throw Object.assign(new Error('La auditoría no coincide en el ensayo.'), { code: 'PHYSICAL_REHEARSAL_MISMATCH' })
  const insuranceMatch = insuranceRows.length === (dependencies.insurance || []).length && binaryDigest(insuranceRows, 'vehicle_id', 'pdf_data') === binaryDigest(dependencies.insurance || [], 'vehicle_id', 'pdf_data')
  const photosMatch = photoRows.length === (dependencies.photos || []).length && binaryDigest(photoRows, 'record_id', 'photo_data') === binaryDigest(dependencies.photos || [], 'record_id', 'photo_data')
  if (!insuranceMatch || !photosMatch) throw Object.assign(new Error('Los adjuntos binarios no coinciden en el ensayo.'), { code: 'PHYSICAL_REHEARSAL_MISMATCH' })
  return {
    credentials: credentialRows.length, loginAttempts: loginRows.length, auxiliaryPreferences: preferenceRows.length, auditEvents: auditRows.length,
    insuranceDocuments: insuranceRows.length, vehicleControlPhotos: photoRows.length,
    credentialsPreserved: true, accessBlocksPreserved: true, auxiliaryPreferencesPreserved: true, auditPreserved: true,
    insuranceBytesPreserved: true, photoBytesPreserved: true,
    sessionsCopied: 0, sourceSessionsInvalidatedAtCutover: Number(dependencies.sessionCount || 0)
  }
}

async function rehearsePrivilegedDependencies(sql, state, dependencies) {
  const inserted = await insertPrivilegedDependencies(sql, state, dependencies)
  return verifyPrivilegedDependencies(sql, state, dependencies, inserted)
}

module.exports = { binaryDigest, insertPrivilegedDependencies, rehearsePrivilegedDependencies, verifyPrivilegedDependencies }
