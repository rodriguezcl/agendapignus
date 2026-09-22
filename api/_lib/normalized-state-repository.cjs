function payload(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

async function queryRows(sql, statement, parameters = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, parameters) : await sql.unsafe(statement, parameters)
  return result.rows || result
}

async function readNormalizedState(sql, { includeCredentials = false, includeControl = false, allowMissing = false } = {}) {
  // Reconstruct the complete application snapshot in one database round trip.
  // The previous implementation issued seven sequential queries; every state
  // write performed that work while holding the global revision row lock.
  const credentialsProjection = includeCredentials
    ? `coalesce((
        select jsonb_agg(jsonb_build_object(
          'employee_id', employee_id,
          'password_hash', password_hash
        ) order by employee_id)
        from normalized_shadow.employee_credentials
      ), '[]'::jsonb)`
    : `'[]'::jsonb`
  const [batch] = await queryRows(sql, `
    select
      ${includeControl ? `(select jsonb_build_object('model', active_model, 'revision', active_revision) from normalized_shadow.storage_control where id = 1)` : 'null'} as storage_control,
      source_revision as revision,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'collection', collection,
          'original_payload', original_payload
        ) order by collection, source_position)
        from normalized_shadow.source_record_evidence
      ), '[]'::jsonb) as evidence,
      ${credentialsProjection} as credentials,
      coalesce((
        select jsonb_agg(original_payload order by source_position)
        from normalized_shadow.history_evidence
      ), '[]'::jsonb) as history,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'scope', scope,
          'work_date', work_date::text,
          'original_payload', original_payload
        ) order by scope, work_date)
        from normalized_shadow.agenda_plan_evidence
      ), '[]'::jsonb) as plans,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'config_key', config_key,
          'original_payload', original_payload
        ) order by config_key)
        from normalized_shadow.configuration_evidence
      ), '[]'::jsonb) as configs,
      coalesce((
        select jsonb_object_agg(preference_key, preference_value)
        from normalized_shadow.app_preferences
      ), '{}'::jsonb) as preferences
    from normalized_shadow.import_batch
    where id = 1
  `)
  if (!batch && allowMissing) return null
  if (!batch) { const error = new Error('El modelo normalizado todavía no tiene un lote importado.'); error.code = 'NORMALIZED_STATE_EMPTY'; throw error }
  const rows = value => {
    const parsed = payload(value)
    return Array.isArray(parsed) ? parsed : []
  }
  const evidence = rows(batch.evidence)
  const collection = name => evidence.filter(row => row.collection === name).map(row => payload(row.original_payload))
  const employees = collection('employees_without_credentials')
  if (includeCredentials) {
    const credentials = new Map(rows(batch.credentials).map(row => [String(row.employee_id), row.password_hash]))
    for (const employee of employees) if (credentials.has(String(employee.id))) employee.passwordHash = credentials.get(String(employee.id))
  }
  const history = rows(batch.history).map(payload)
  const plans = rows(batch.plans)
  const configs = rows(batch.configs)
  const weekly = Object.fromEntries(configs.map(row => [row.config_key, payload(row.original_payload)]))
  let daily = { date: '', teams: [] }
  for (const row of plans) {
    if (row.scope === 'weekly') weekly[row.work_date] = payload(row.original_payload)
    else daily = payload(row.original_payload)
  }
  const preferences = payload(batch.preferences) || {}
  const state = {
    revision: Number(batch.revision || 0),
    roles: collection('roles'), employees,
    services: collection('service_types'), vehicles: collection('vehicles'),
    customers: collection('customers'), history,
    agenda: { ...daily, weekly }, reviews: collection('reviews'), preferences
  }
  return includeControl ? { state, control: payload(batch.storage_control) } : state
}

const TABLE_KEYS = {
  roles: ['id'], role_permissions: ['role_id', 'permission'], employees: ['id'], customers: ['id'], customer_import_fields: ['customer_id', 'field_name'],
  service_types: ['id'], vehicles: ['id'], daily_teams: ['work_date', 'team_key'], team_members: ['work_date', 'team_key', 'employee_id'], jobs: ['id'],
  vehicle_controls: ['job_id'], service_assignments: ['job_id', 'employee_id'], job_checklist_items: ['job_id', 'item_id'], job_events: ['job_id', 'event_kind'],
  job_reservations: ['job_id'], planned_days: ['scope', 'work_date'], planned_teams: ['scope', 'work_date', 'team_key'],
  planned_team_members: ['scope', 'work_date', 'team_key', 'employee_id'], planned_slots: ['id'], monthly_configurations: ['period'],
  monthly_default_times: ['period', 'source_kind', 'effective_from', 'position'], monthly_teams: ['period', 'team_key'],
  monthly_team_members: ['period', 'team_key', 'employee_id'], monthly_vehicle_assignments: ['period', 'position'], annual_guard_plans: ['plan_year'],
  annual_guard_rotation: ['plan_year', 'position'], holiday_overrides: ['work_date'], app_preferences: ['preference_key'],
  source_record_evidence: ['collection', 'record_id'], history_evidence: ['job_id'], agenda_plan_evidence: ['scope', 'work_date'], agenda_evidence: ['id'],
  configuration_evidence: ['config_key'], configuration_event_evidence: ['id'], reconciliation_cases: ['id']
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const equivalent = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const rowKey = (row, keys) => JSON.stringify(keys.map(key => row[key] == null ? null : String(row[key])))
const MAX_BATCH_PARAMETERS = 30_000
const MAX_DELETE_BATCH_ROWS = 1_000
const POSITIONAL_UNIQUE_BUCKETS = {
  planned_teams: ['scope', 'work_date'],
  monthly_teams: ['period']
}

const positionBucketKey = (row, keys) => rowKey(row, keys)

function changedPositionBuckets(beforeRows, nextRows, bucketKeys, identityKeys) {
  const byPosition = rows => new Map(rows.map(row => [JSON.stringify([positionBucketKey(row, bucketKeys), Number(row.position)]), rowKey(row, identityKeys)]))
  const before = byPosition(beforeRows), next = byPosition(nextRows), changed = new Set()
  for (const position of new Set([...before.keys(), ...next.keys()])) {
    if (before.get(position) !== next.get(position)) changed.add(JSON.parse(position)[0])
  }
  return changed
}

async function vacateChangedPositions(sql, table, beforeRows, nextRows, identityKeys) {
  const bucketKeys = POSITIONAL_UNIQUE_BUCKETS[table]
  if (!bucketKeys) return new Set()
  const changed = changedPositionBuckets(beforeRows, nextRows, bucketKeys, identityKeys)
  const buckets = new Map(beforeRows.map(row => [positionBucketKey(row, bucketKeys), bucketKeys.map(key => row[key])]))
  for (const bucket of changed) {
    const values = buckets.get(bucket)
    if (!values) continue
    const conditions = bucketKeys.map((key, index) => `${key} = $${index + 2}`).join(' and ')
    // Free the final non-negative positions before swapping/replacing rows.
    // The enclosing transaction makes this temporary offset invisible.
    await queryRows(sql, `update normalized_shadow.${table} set position = position + $1 where ${conditions}`, [1_000_000, ...values])
  }
  return changed
}

async function vacateTransferredJobTaskIds(sql, beforeRows, nextRows, identityKeys) {
  const ownerByTaskId = rows => new Map(rows
    .filter(row => row.source_task_id != null && String(row.source_task_id).trim())
    .map(row => [String(row.source_task_id), rowKey(row, identityKeys)]))
  const beforeOwners = ownerByTaskId(beforeRows)
  const nextOwners = ownerByTaskId(nextRows)
  const transferred = new Set([...nextOwners].filter(([taskId, owner]) => beforeOwners.has(taskId) && beforeOwners.get(taskId) !== owner).map(([taskId]) => taskId))
  const previousOwnerIds = beforeRows
    .filter(row => transferred.has(String(row.source_task_id || '')))
    .map(row => row.id)
  if (!previousOwnerIds.length) return
  const placeholders = previousOwnerIds.map((_, index) => `$${index + 1}`).join(',')
  // source_task_id is the stable identity of a service, but legacy repairs can
  // move it to a corrected history row. Free the old owner inside the same
  // transaction before inserting the replacement row.
  await queryRows(sql, `update normalized_shadow.jobs set source_task_id = null where id in (${placeholders})`, previousOwnerIds)
}

async function bulkUpsertRows(sql, table, keys, rows) {
  if (!rows.length) return 0
  const groups = new Map()
  for (const row of rows) {
    const columns = Object.keys(row)
    const signature = columns.join('\u0000')
    const group = groups.get(signature) || { columns, rows: [] }
    group.rows.push(row)
    groups.set(signature, group)
  }
  for (const { columns, rows: groupRows } of groups.values()) {
    const updates = columns.filter(column => !keys.includes(column))
    const assignments = updates.map(column => table === 'jobs' && column === 'version'
      ? 'version = normalized_shadow.jobs.version + 1'
      : `${column} = excluded.${column}`)
    const batchSize = Math.max(1, Math.floor(MAX_BATCH_PARAMETERS / columns.length))
    for (let offset = 0; offset < groupRows.length; offset += batchSize) {
      const batch = groupRows.slice(offset, offset + batchSize)
      const parameters = batch.flatMap(row => columns.map(column => row[column]))
      let parameterIndex = 0
      const values = batch.map(() => `(${columns.map(() => `$${++parameterIndex}`).join(',')})`).join(',')
      await queryRows(sql, `insert into normalized_shadow.${table} (${columns.join(',')}) values ${values} on conflict (${keys.join(',')}) do ${assignments.length ? `update set ${assignments.join(',')}` : 'nothing'}`, parameters)
    }
  }
  return rows.length
}

async function bulkDeleteRows(sql, table, keys, rows) {
  if (!rows.length) return 0
  const batchSize = Math.max(1, Math.min(MAX_DELETE_BATCH_ROWS, Math.floor(MAX_BATCH_PARAMETERS / keys.length)))
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize)
    const parameters = batch.flatMap(row => keys.map(key => row[key]))
    if (keys.length === 1) {
      const placeholders = batch.map((_, index) => `$${index + 1}`).join(',')
      await queryRows(sql, `delete from normalized_shadow.${table} where ${keys[0]} in (${placeholders})`, parameters)
      continue
    }
    let parameterIndex = 0
    const tuples = batch.map(() => `(${keys.map(() => `$${++parameterIndex}`).join(',')})`).join(',')
    await queryRows(sql, `delete from normalized_shadow.${table} where (${keys.join(',')}) in (${tuples})`, parameters)
  }
  return rows.length
}

async function synchronizeCredentials(sql, employees) {
  let changedRows = 0
  const existing = new Map((await queryRows(sql, 'select employee_id, password_hash from normalized_shadow.employee_credentials')).map(row => [String(row.employee_id), row.password_hash]))
  const next = new Map((employees || []).filter(employee => employee.passwordHash).map(employee => [String(employee.id), employee.passwordHash]))
  for (const [employeeId, passwordHash] of next) {
    if (existing.get(employeeId) === passwordHash) continue
    await queryRows(sql, `insert into normalized_shadow.employee_credentials (employee_id, password_hash, changed_at) values ($1,$2,now())
      on conflict (employee_id) do update set password_hash=excluded.password_hash, changed_at=now()`, [employeeId, passwordHash])
    changedRows++
  }
  for (const employeeId of existing.keys()) if (!next.has(employeeId)) {
    await queryRows(sql, 'delete from normalized_shadow.employee_credentials where employee_id = $1', [employeeId])
    changedRows++
  }
  return changedRows
}

function prepareNormalizedStateWrite(previousState, nextState) {
  // Lazy import avoids a module cycle during isolated rehearsal startup.
  const { buildShadowCandidate } = require('./normalization-rehearsal.cjs')
  const previous = buildShadowCandidate(previousState), next = buildShadowCandidate(nextState)
  return { previous, next }
}

async function synchronizeNormalizedStateInTransaction(sql, previousState, nextState, prepared) {
  const { previous, next } = prepared || prepareNormalizedStateWrite(previousState, nextState)
  const [batch] = await queryRows(sql, 'select source_fingerprint, source_revision from normalized_shadow.import_batch where id = 1 for update')
  if (!batch) { const error = new Error('El modelo normalizado todavía no tiene un lote importado.'); error.code = 'NORMALIZED_STATE_EMPTY'; throw error }
  if (batch.source_fingerprint === next.analysis.sourceFingerprint && Number(batch.source_revision) === Number(next.analysis.revision)) {
    const credentialChanges = await synchronizeCredentials(sql, nextState.employees)
    return { revision: next.analysis.revision, sourceFingerprint: next.analysis.sourceFingerprint, previousSourceFingerprint: previous.analysis.sourceFingerprint, idempotent: true, changedRows: credentialChanges }
  }
  if (batch.source_fingerprint !== previous.analysis.sourceFingerprint || Number(batch.source_revision) !== Number(previous.analysis.revision)) {
    const error = new Error('El modelo normalizado cambió o no coincide con la revisión base. No se aplicaron cambios.')
    error.code = 'NORMALIZED_WRITE_CONFLICT'
    throw error
  }
  let changedRows = 0
  const tableNames = Object.keys(TABLE_KEYS)
  // Parents are inserted before children and existing children are moved to
  // their new parents before obsolete parent rows are removed.
  for (const table of tableNames) {
    const keys = TABLE_KEYS[table], beforeRows = previous.tables[table] || [], nextRows = next.tables[table] || []
    const vacatedBuckets = await vacateChangedPositions(sql, table, beforeRows, nextRows, keys)
    if (table === 'jobs') await vacateTransferredJobTaskIds(sql, beforeRows, nextRows, keys)
    const positionBucketKeys = POSITIONAL_UNIQUE_BUCKETS[table]
    const before = new Map(beforeRows.map(row => [rowKey(row, keys), row]))
    const changed = []
    for (const row of nextRows) {
      const old = before.get(rowKey(row, keys))
      const positionVacated = positionBucketKeys && vacatedBuckets.has(positionBucketKey(row, positionBucketKeys))
      if (!positionVacated && old && equivalent(old, row)) continue
      changed.push(row)
    }
    changedRows += await bulkUpsertRows(sql, table, keys, changed)
  }
  // Credentials reference employees. New parent rows must exist before their
  // password hashes are inserted; credentials for removed employees must be
  // deleted before the reverse dependency pass removes those employees.
  changedRows += await synchronizeCredentials(sql, nextState.employees)
  // Once every surviving row points at its final parent, children and then
  // obsolete parents can be removed in reverse dependency order.
  for (const table of [...tableNames].reverse()) {
    const keys = TABLE_KEYS[table], before = new Map((previous.tables[table] || []).map(row => [rowKey(row, keys), row])), after = new Map((next.tables[table] || []).map(row => [rowKey(row, keys), row]))
    const removed = [...before].filter(([identity]) => !after.has(identity)).map(([, row]) => row)
    changedRows += await bulkDeleteRows(sql, table, keys, removed)
  }
  await queryRows(sql, "update normalized_shadow.import_batch set source_fingerprint = $1, source_revision = $2, status = case when (select active_model from normalized_shadow.storage_control where id = 1) = 'normalized' then 'active' else 'shadow' end, report = $3 where id = 1",
    [next.analysis.sourceFingerprint, next.analysis.revision, next.analysis.summary])
  return { revision: next.analysis.revision, sourceFingerprint: next.analysis.sourceFingerprint, previousSourceFingerprint: previous.analysis.sourceFingerprint, idempotent: false, changedRows }
}

async function synchronizeNormalizedState(sql, previousState, nextState) {
  if (typeof sql.begin === 'function') {
    return sql.begin(transaction => synchronizeNormalizedStateInTransaction(transaction, previousState, nextState))
  }
  if (typeof sql.exec !== 'function') {
    const error = new Error('El adaptador normalizado no permite iniciar una transacción atómica.')
    error.code = 'NORMALIZED_TRANSACTION_UNAVAILABLE'
    throw error
  }
  await sql.exec('begin')
  try {
    const result = await synchronizeNormalizedStateInTransaction(sql, previousState, nextState)
    await sql.exec('commit')
    return result
  } catch (error) {
    await sql.exec('rollback')
    throw error
  }
}

module.exports = { bulkDeleteRows, bulkUpsertRows, prepareNormalizedStateWrite, readNormalizedState, synchronizeNormalizedState, synchronizeNormalizedStateInTransaction }
