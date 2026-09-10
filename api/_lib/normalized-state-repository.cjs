function payload(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

async function queryRows(sql, statement, parameters = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, parameters) : await sql.unsafe(statement, parameters)
  return result.rows || result
}

async function readNormalizedState(sql, { includeCredentials = false } = {}) {
  const [batch] = await queryRows(sql, 'select source_revision as revision from normalized_shadow.import_batch where id = 1')
  if (!batch) { const error = new Error('El modelo normalizado todavía no tiene un lote importado.'); error.code = 'NORMALIZED_STATE_EMPTY'; throw error }
  const evidence = await queryRows(sql, 'select collection, original_payload from normalized_shadow.source_record_evidence order by collection, source_position')
  const collection = name => evidence.filter(row => row.collection === name).map(row => payload(row.original_payload))
  const employees = collection('employees_without_credentials')
  if (includeCredentials) {
    const credentials = new Map((await queryRows(sql, 'select employee_id, password_hash from normalized_shadow.employee_credentials')).map(row => [String(row.employee_id), row.password_hash]))
    for (const employee of employees) if (credentials.has(String(employee.id))) employee.passwordHash = credentials.get(String(employee.id))
  }
  const history = (await queryRows(sql, 'select original_payload from normalized_shadow.history_evidence order by source_position')).map(row => payload(row.original_payload))
  const plans = await queryRows(sql, "select scope, work_date::text as work_date, original_payload from normalized_shadow.agenda_plan_evidence order by scope, work_date")
  const configs = await queryRows(sql, 'select config_key, original_payload from normalized_shadow.configuration_evidence order by config_key')
  const weekly = Object.fromEntries(configs.map(row => [row.config_key, payload(row.original_payload)]))
  let daily = { date: '', teams: [] }
  for (const row of plans) {
    if (row.scope === 'weekly') weekly[row.work_date] = payload(row.original_payload)
    else daily = payload(row.original_payload)
  }
  const preferences = Object.fromEntries((await queryRows(sql, 'select preference_key, preference_value from normalized_shadow.app_preferences order by preference_key')).map(row => [row.preference_key, row.preference_value]))
  return {
    revision: Number(batch.revision || 0),
    roles: collection('roles'), employees,
    services: collection('service_types'), vehicles: collection('vehicles'),
    customers: collection('customers'), history,
    agenda: { ...daily, weekly }, reviews: collection('reviews'), preferences
  }
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

async function synchronizeNormalizedStateInTransaction(sql, previousState, nextState) {
  // Lazy import avoids a module cycle during isolated rehearsal startup.
  const { buildShadowCandidate } = require('./normalization-rehearsal.cjs')
  const previous = buildShadowCandidate(previousState), next = buildShadowCandidate(nextState)
  const [batch] = await queryRows(sql, 'select source_fingerprint, source_revision from normalized_shadow.import_batch where id = 1 for update')
  if (!batch) { const error = new Error('El modelo normalizado todavía no tiene un lote importado.'); error.code = 'NORMALIZED_STATE_EMPTY'; throw error }
  const credentialChanges = await synchronizeCredentials(sql, nextState.employees)
  if (batch.source_fingerprint === next.analysis.sourceFingerprint && Number(batch.source_revision) === Number(next.analysis.revision)) {
    return { revision: next.analysis.revision, sourceFingerprint: next.analysis.sourceFingerprint, previousSourceFingerprint: previous.analysis.sourceFingerprint, idempotent: true, changedRows: credentialChanges }
  }
  if (batch.source_fingerprint !== previous.analysis.sourceFingerprint || Number(batch.source_revision) !== Number(previous.analysis.revision)) {
    const error = new Error('El modelo normalizado cambió o no coincide con la revisión base. No se aplicaron cambios.')
    error.code = 'NORMALIZED_WRITE_CONFLICT'
    throw error
  }
  let changedRows = credentialChanges
  const tableNames = Object.keys(TABLE_KEYS)
  // Parents are inserted before children and existing children are moved to
  // their new parents before obsolete parent rows are removed.
  for (const table of tableNames) {
    const keys = TABLE_KEYS[table], before = new Map((previous.tables[table] || []).map(row => [rowKey(row, keys), row]))
    for (const row of next.tables[table] || []) {
      const old = before.get(rowKey(row, keys))
      if (old && equivalent(old, row)) continue
      const columns = Object.keys(row), parameters = columns.map(column => row[column]), updates = columns.filter(column => !keys.includes(column))
      const assignments = updates.map(column => table === 'jobs' && column === 'version' ? 'version = normalized_shadow.jobs.version + 1' : `${column} = excluded.${column}`)
      await queryRows(sql, `insert into normalized_shadow.${table} (${columns.join(',')}) values (${columns.map((_, index) => `$${index + 1}`).join(',')}) on conflict (${keys.join(',')}) do ${assignments.length ? `update set ${assignments.join(',')}` : 'nothing'}`, parameters)
      changedRows++
    }
  }
  // Once every surviving row points at its final parent, children and then
  // obsolete parents can be removed in reverse dependency order.
  for (const table of [...tableNames].reverse()) {
    const keys = TABLE_KEYS[table], before = new Map((previous.tables[table] || []).map(row => [rowKey(row, keys), row])), after = new Map((next.tables[table] || []).map(row => [rowKey(row, keys), row]))
    for (const [identity, row] of before) if (!after.has(identity)) {
      const parameters = keys.map(key => row[key])
      await queryRows(sql, `delete from normalized_shadow.${table} where ${keys.map((key, index) => `${key} = $${index + 1}`).join(' and ')}`, parameters)
      changedRows++
    }
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

module.exports = { readNormalizedState, synchronizeNormalizedState, synchronizeNormalizedStateInTransaction }
