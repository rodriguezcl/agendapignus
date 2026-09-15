const fs = require('node:fs')
const path = require('node:path')
const { analyzeNormalization, fingerprint, sortedIds } = require('./normalization-analysis.cjs')
const { readNormalizedState } = require('./normalized-state-repository.cjs')

function buildShadowCandidate(state) {
  const analysis = analyzeNormalization(state)
  if (analysis.summary.bySeverity.error) {
    const error = new Error('Hay errores de integridad que impiden construir el modelo de ensayo.')
    error.code = 'NORMALIZATION_INTEGRITY_ERRORS'
    error.summary = analysis.summary
    throw error
  }
  const jobs = state.history || [], groups = new Map()
  const affected = new Set(analysis.issues.filter(issue => issue.severity === 'review').flatMap(issue => [issue.recordId, ...(issue.details.records || [])]).filter(Boolean))
  for (const job of jobs) {
    if (!job.teamId) continue
    const id = JSON.stringify([job.date, String(job.teamId)])
    const group = groups.get(id) || { date: job.date, id: String(job.teamId), alternatives: new Map() }
    if (!job.vehicleControl) {
      const members = [...new Set(sortedIds(job.technicianIds))]
      group.alternatives.set(JSON.stringify(members), members)
    }
    groups.set(id, group)
  }
  const monthly = state.agenda?.weekly?._monthlyTeams || {}
  const annual = state.agenda?.weekly?._annualGuards || {}
  const holidays = state.agenda?.weekly?._holidayOverrides || {}
  const plans = Object.entries(state.agenda?.weekly || {}).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date)).map(([date, plan]) => ({ scope: 'weekly', date, plan }))
  if (state.agenda?.date) plans.push({ scope: 'daily', date: state.agenda.date, plan: state.agenda })
  const occurrenceBySlot = new Map(analysis.occurrences.map(item => [item.id, item]))
  const planRows = plans.flatMap(({ scope, date, plan }) => (plan.teams || []).map((team, teamIndex) => ({ scope, date, team, teamIndex })))
  const safeEmployees = state.employees.map(({ password, passwordHash, ...employee }) => employee)
  const slotRows = planRows.flatMap(({ scope, date, team, teamIndex }) => (team.tasks || []).map((task, taskIndex) => {
    const id = fingerprint({ scope, date, teamIndex, taskIndex }), occurrence = occurrenceBySlot.get(id)
    const hasContent = Boolean(task.serviceId || task.service || task.client)
    return { id, scope, work_date: date, team_key: String(team.teamId), position: taskIndex, candidate_job_id: occurrence?.recordId || null,
      slot_kind: occurrence?.recordId ? 'linked_job' : !hasContent ? 'availability' : task.vehicleControl ? 'unlinked_vehicle_control' : 'unlinked_service',
      scheduled_time: task.time || null, status_snapshot: task.status || null }
  }))
  const tables = {
    roles: state.roles.map(role => ({ id: String(role.id), code: role.code || null, name: role.name || '', description: role.description || null })),
    role_permissions: state.roles.flatMap(role => Object.entries(role.permissions || {}).map(([permission, allowed]) => ({ role_id: String(role.id), permission, allowed: Boolean(allowed) }))),
    employees: state.employees.map(employee => ({ id: String(employee.id), role_id: String(employee.roleId), first_name: employee.firstName || null, last_name: employee.lastName || null,
      name: employee.name || '', email: employee.email || null, phone: employee.phone || null, status: employee.status || null })),
    customers: state.customers.map(customer => ({ id: String(customer.customerId), account: customer.account, name: customer.name || '', kind: customer.kind || null, customer_type: customer.type || null,
      address: customer.address || null, street: customer.street || null, locality: customer.locality || null, province: customer.province || null, phone: customer.phone || null,
      converted_from_account: customer.convertedFromAccount || null, subscription_ended_at: customer.subscriptionEndedAt || null, cctv_service: Boolean(customer.cctvService) })),
    customer_import_fields: state.customers.flatMap(customer => Object.entries(customer.fields || {}).map(([field_name, field_value]) => ({ customer_id: String(customer.customerId), field_name, field_value: field_value == null ? null : String(field_value) }))),
    service_types: state.services.map(service => ({ id: String(service.id), code: service.code, name: service.name, description: service.description || null, category: service.category || null,
      status: service.status || null, system_managed: Boolean(service.system), estimated_minutes: Number(service.estimatedMinutes) })),
    vehicles: state.vehicles.map(vehicle => ({ id: String(vehicle.id), plate: vehicle.plate, brand: vehicle.brand || null, model: vehicle.model || null, model_year: vehicle.year == null ? null : Number(vehicle.year),
      mileage: vehicle.mileage == null ? null : Number(vehicle.mileage), mileage_updated_at: vehicle.mileageUpdatedAt || null, mileage_updated_by_id: vehicle.mileageUpdatedById == null ? null : String(vehicle.mileageUpdatedById),
      mileage_updated_by_name: vehicle.mileageUpdatedByName || null, insurance_expires_on: vehicle.insuranceExpiresOn || null, insurance_file_name: vehicle.insuranceFileName || null,
      insurance_uploaded_at: vehicle.insuranceUploadedAt || null, insurance_document_url: vehicle.insuranceDocumentUrl || null })),
    daily_teams: [...groups.values()].map(group => ({ work_date: group.date, team_key: group.id, membership_resolved: group.alternatives.size === 1 })),
    team_members: [...groups.values()].flatMap(group => group.alternatives.size === 1 ? [...group.alternatives.values()][0].map(id => ({ work_date: group.date, team_key: group.id, employee_id: id })) : []),
    jobs: jobs.map(job => ({ id: String(job.id), source_task_id: job.sourceTaskId ? String(job.sourceTaskId) : null, legacy_task_id: job.taskId ? String(job.taskId) : null, legacy_history_id: job.historyId ? String(job.historyId) : null,
      job_kind: job.vehicleControl ? 'vehicle_control' : 'service', work_date: job.date, scheduled_date_snapshot: job.scheduledDate || null, scheduled_time: job.time || null,
      estimated_minutes: Number(job.estimatedMinutes), status: job.status, customer_id: job.customerId ? String(job.customerId) : null,
      service_type_id: String(job.serviceId), team_key: job.teamId ? String(job.teamId) : null, client_snapshot: job.client || null, client_account_snapshot: job.clientAccount || null,
      client_name_snapshot: job.clientNameAtService || null, service_name_snapshot: job.service || null, team_name_snapshot: job.team || null, address_snapshot: job.address || null,
      phone_snapshot: job.phone || null, detail: job.detail || '', internal_note: job.internalNote || null, installation_zone: job.installationZone || null, form_name: job.form || null,
      amount_text: job.amount || null, monthly_fee_text: job.monthlyFee || null, payment_method: job.paymentMethod || null, estimated_minutes_customized: Boolean(job.estimatedMinutesCustomized),
      new_customer: Boolean(job.newCustomer), manual_slot: Boolean(job.manualSlot), subscriber_reservation: Boolean(job.subscriberReservation), sort_order: job.order == null ? null : Number(job.order),
      monthly_vehicle_assignment: job.monthlyVehicleAssignment || null, rescheduled_from: job.rescheduledFrom || null, reprogrammed_at: job.reprogrammedAt || null,
      technician_request: job.technicianRequest || null, technical_status: job.technicalStatus || null, technical_observation: job.technicalObservation || null,
      completed_at: job.completedAt || null, version: 1, needs_review: affected.has(String(job.id)) })),
    vehicle_controls: jobs.filter(job => job.vehicleControl).map(job => ({ job_id: String(job.id), vehicle_id: String(job.vehicleId), scheduled_friday: job.vehicleControlScheduledFriday || job.date,
      mileage_at_scheduling: job.vehicleMileageAtScheduling == null ? null : Number(job.vehicleMileageAtScheduling), reported_mileage: job.vehicleMileage == null ? null : Number(job.vehicleMileage),
      vehicle_brand_snapshot: job.vehicleBrand || null, vehicle_model_snapshot: job.vehicleModel || null, vehicle_plate_snapshot: job.vehiclePlate || null })),
    service_assignments: jobs.flatMap(job => [...new Set(sortedIds(job.technicianIds))].map(id => ({ job_id: String(job.id), employee_id: id }))),
    job_checklist_items: jobs.flatMap(job => (job.internalChecklist || []).map((item, position) => ({ job_id: String(job.id), item_id: String(item.id), position, item_text: item.text || '', completed: Boolean(item.completed) }))),
    job_events: jobs.flatMap(job => [
      job.createdBy && { job_id: String(job.id), event_kind: 'created', occurred_at: job.createdBy.at || null, employee_id: job.createdBy.id == null ? null : String(job.createdBy.id), actor_name: job.createdBy.name || null, actor_role: job.createdBy.role || null },
      job.reservationCreatedAt && { job_id: String(job.id), event_kind: 'reservation_created', occurred_at: job.reservationCreatedAt, employee_id: job.reservationCreatedBy?.id == null ? null : String(job.reservationCreatedBy.id), actor_name: job.reservationCreatedBy?.name || null, actor_role: job.reservationCreatedBy?.role || null },
      job.reservationLinkedAt && { job_id: String(job.id), event_kind: 'reservation_linked', occurred_at: job.reservationLinkedAt, employee_id: job.reservationLinkedBy?.id == null ? null : String(job.reservationLinkedBy.id), actor_name: job.reservationLinkedBy?.name || null, actor_role: job.reservationLinkedBy?.role || null },
      job.technicalReportedAt && { job_id: String(job.id), event_kind: 'technical_reported', occurred_at: job.technicalReportedAt, employee_id: job.technicalReportedById == null ? null : String(job.technicalReportedById), actor_name: job.technicalReportedByName || null, actor_role: null }
    ].filter(Boolean)),
    job_reservations: jobs.filter(job => job.reservationOriginal || job.reservationCreatedAt || job.reservationLinkedAt).map(job => ({ job_id: String(job.id), original_name: job.reservationOriginal?.name || null,
      original_address: job.reservationOriginal?.address || null, original_phone: job.reservationOriginal?.phone || null })),
    planned_days: plans.map(({ scope, date }) => ({ scope, work_date: date })),
    planned_teams: planRows.map(({ scope, date, team, teamIndex }) => ({ scope, work_date: date, team_key: String(team.teamId), position: teamIndex, display_label: team.label || null })),
    planned_team_members: planRows.flatMap(({ scope, date, team }) => [...new Set(sortedIds(team.memberIds || team.technicianIds))].map(employee_id => ({ scope, work_date: date, team_key: String(team.teamId), employee_id }))),
    planned_slots: slotRows,
    monthly_configurations: Object.entries(monthly).filter(([period]) => /^\d{4}-\d{2}$/.test(period)).map(([period]) => ({ period })),
    monthly_default_times: Object.entries(monthly).filter(([period]) => /^\d{4}-\d{2}$/.test(period)).flatMap(([period, config]) => [
      ...(config.defaultTimes || []).map((time, position) => ({ period, source_kind: 'default', effective_from: '', position, default_time: time })),
      ...(config.defaultTimePeriods || []).flatMap((range, rangePosition) => (range.times || []).map((time, position) => ({ period, source_kind: 'period', effective_from: range.from || '', position: rangePosition * 100 + position, default_time: time })))
    ]),
    monthly_teams: Object.entries(monthly).filter(([period]) => /^\d{4}-\d{2}$/.test(period)).flatMap(([period, config]) => (config.teams || []).map((team, position) => ({ period, team_key: String(team.teamId), position, display_label: team.label || null }))),
    monthly_team_members: Object.entries(monthly).filter(([period]) => /^\d{4}-\d{2}$/.test(period)).flatMap(([period, config]) => (config.teams || []).flatMap(team => [...new Set(sortedIds(team.memberIds || team.technicianIds))].map(employee_id => ({ period, team_key: String(team.teamId), employee_id })))),
    monthly_vehicle_assignments: Object.entries(monthly).filter(([period]) => /^\d{4}-\d{2}$/.test(period)).flatMap(([period, config]) => (config.vehicleAssignments || []).map((assignment, position) => ({ period, position,
      vehicle_id: String(assignment.vehicleId), employee_id: String(assignment.technicianId), vehicle_snapshot: assignment.vehicle || null, technician_snapshot: assignment.technician || null }))),
    annual_guard_plans: Object.entries(annual).filter(([year]) => /^\d{4}$/.test(year)).map(([year, config]) => ({ plan_year: Number(year), start_date: config.startDate })),
    annual_guard_rotation: Object.entries(annual).filter(([year]) => /^\d{4}$/.test(year)).flatMap(([year, config]) => (config.rotation || []).map((entry, position) => ({ plan_year: Number(year), position,
      employee_id: String(entry.technicianId), technician_snapshot: entry.name || null }))),
    holiday_overrides: Object.entries(holidays).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date)).map(([date, item]) => ({ work_date: date, status: item.status,
      holiday_name: item.holidayName || null, decided_at: item.decidedAt || null, decided_by_id: item.decidedById == null ? null : String(item.decidedById), decided_by_name: item.decidedByName || null })),
    app_preferences: [{ preference_key: 'theme', preference_value: state.preferences?.theme || 'light' }],
    source_record_evidence: [
      ...state.roles.map((record, source_position) => ({ collection: 'roles', record_id: String(record.id), source_position, original_payload: structuredClone(record) })),
      ...safeEmployees.map((record, source_position) => ({ collection: 'employees_without_credentials', record_id: String(record.id), source_position, original_payload: structuredClone(record) })),
      ...state.customers.map((record, source_position) => ({ collection: 'customers', record_id: String(record.customerId), source_position, original_payload: structuredClone(record) })),
      ...state.services.map((record, source_position) => ({ collection: 'service_types', record_id: String(record.id), source_position, original_payload: structuredClone(record) })),
      ...state.vehicles.map((record, source_position) => ({ collection: 'vehicles', record_id: String(record.id), source_position, original_payload: structuredClone(record) })),
      ...state.reviews.map((record, source_position) => ({ collection: 'reviews', record_id: String(record.id ?? source_position), source_position, original_payload: structuredClone(record) }))
    ],
    history_evidence: jobs.map((job, source_position) => ({ job_id: String(job.id), source_position, original_payload: structuredClone(job) })),
    agenda_plan_evidence: plans.map(({ scope, date, plan }) => {
      if (scope === 'weekly') return { scope, work_date: date, original_payload: structuredClone(plan) }
      const { weekly, ...dailyPlan } = plan
      return { scope, work_date: date, original_payload: structuredClone(dailyPlan) }
    }),
    agenda_evidence: analysis.occurrences.map(item => ({ id: item.id, scope: item.scope, work_date: item.date, original_team_id: item.teamId, candidate_job_id: item.recordId, original_payload: item.source })),
    // Preserve every non-day legacy key, including unknown or empty keys. Known
    // configuration keys are normalized above; unknown keys remain evidence so
    // a migration never erases data merely because an older client named it.
    configuration_evidence: Object.entries(state.agenda?.weekly || {}).filter(([name]) => !/^\d{4}-\d{2}-\d{2}$/.test(name)).map(([name, config]) => ({ config_key: name, original_payload: structuredClone(config) })),
    configuration_event_evidence: [monthly, annual].flatMap(group => Object.values(group).flatMap(config => config?.configurationHistory || [])).map(event => ({ id: String(event.id), config_kind: event.type || 'unknown', period: event.period || null, occurred_at: event.at || null, original_payload: structuredClone(event) })),
    reconciliation_cases: analysis.issues.map(issue => ({ id: issue.id, kind: issue.type, severity: issue.severity, location: issue.location, record_id: issue.recordId, details: issue.details, status: 'open' }))
  }
  return { analysis, tables }
}

async function insertShadowCandidate(pg, candidate) {
  const query = (statement, parameters = []) => typeof pg.query === 'function' ? pg.query(statement, parameters) : pg.unsafe(statement, parameters)
  await query('insert into normalized_shadow.import_batch values (1, $1, $2, $3, $4)', [candidate.analysis.sourceFingerprint, candidate.analysis.revision, 'rehearsal', candidate.analysis.summary])
  for (const [table, rows] of Object.entries(candidate.tables)) {
      // Table and column names originate exclusively from buildShadowCandidate,
      // never from user input. All data is parameterized.
    if (!rows.length) continue
    const columns = Object.keys(rows[0]), batchSize = Math.max(1, Math.floor(5000 / columns.length))
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize), parameters = []
      const values = batch.map(row => `(${columns.map(column => { parameters.push(row[column]); return `$${parameters.length}` }).join(',')})`).join(',')
      try {
        await query(`insert into normalized_shadow.${table} (${columns.join(',')}) values ${values}`, parameters)
      } catch (error) {
        error.normalizationTable = table
        error.normalizationBatchOffset = offset
        throw error
      }
    }
  }
}

function structuralDifferencePaths(left, right, pathName = '$', paths = [], limit = 20) {
  if (paths.length >= limit) return paths
  if (Object.is(left, right)) return paths
  const leftArray = Array.isArray(left), rightArray = Array.isArray(right)
  if (leftArray || rightArray) {
    if (!leftArray || !rightArray) { paths.push(pathName); return paths }
    if (left.length !== right.length) paths.push(`${pathName}.length`)
    for (let index = 0; index < Math.min(left.length, right.length) && paths.length < limit; index++) structuralDifferencePaths(left[index], right[index], `${pathName}[${index}]`, paths, limit)
    return paths
  }
  const leftObject = left !== null && typeof left === 'object', rightObject = right !== null && typeof right === 'object'
  if (leftObject || rightObject) {
    if (!leftObject || !rightObject) { paths.push(pathName); return paths }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      if (!(key in left) || !(key in right)) paths.push(`${pathName}.${key}`)
      else structuralDifferencePaths(left[key], right[key], `${pathName}.${key}`, paths, limit)
      if (paths.length >= limit) break
    }
    return paths
  }
  paths.push(pathName)
  return paths
}

// Always builds a fresh, isolated database. No remote URL or persistent path is accepted.
async function rehearseNormalization(state) {
  const candidate = buildShadowCandidate(state)
  const safeEmployees = state.employees.map(({ password, passwordHash, ...employee }) => employee)
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec('begin')
    const schemaSql = fs.readFileSync(path.join(__dirname, '../../supabase/proposals/normalized-shadow-v1.sql'), 'utf8')
    await pg.exec(schemaSql)
    await pg.exec(schemaSql) // Applying the same reviewed schema twice must be harmless.
    await insertShadowCandidate(pg, candidate)
    const restored = (await pg.query('select original_payload from normalized_shadow.history_evidence order by job_id')).rows.map(row => row.original_payload)
    const original = [...state.history].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))
    // JS sorting on both sides avoids locale differences between SQL and Node.
    restored.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))
    if (fingerprint(restored) !== fingerprint(original)) throw new Error('El ensayo no conservó íntegramente los registros originales.')
    const restoredEvidence = (await pg.query('select collection, original_payload from normalized_shadow.source_record_evidence order by collection, record_id')).rows
    const restoredCollection = collection => restoredEvidence.filter(row => row.collection === collection).map(row => row.original_payload).sort((a, b) => String(a.id ?? a.customerId).localeCompare(String(b.id ?? b.customerId), 'en'))
    const sourceCollection = records => structuredClone(records).sort((a, b) => String(a.id ?? a.customerId).localeCompare(String(b.id ?? b.customerId), 'en'))
    for (const [collection, records] of [['roles', state.roles], ['employees_without_credentials', safeEmployees], ['customers', state.customers], ['service_types', state.services], ['vehicles', state.vehicles], ['reviews', state.reviews]]) {
      if (fingerprint(restoredCollection(collection)) !== fingerprint(sourceCollection(records))) throw new Error(`El ensayo no conservó el catálogo ${collection}.`)
    }
    const restoredPlans = (await pg.query('select scope, work_date::text, original_payload from normalized_shadow.agenda_plan_evidence order by scope, work_date')).rows
    const originalPlans = candidate.tables.agenda_plan_evidence.map(row => ({ scope: row.scope, work_date: row.work_date, original_payload: row.original_payload })).sort((a, b) => `${a.scope}/${a.work_date}`.localeCompare(`${b.scope}/${b.work_date}`, 'en'))
    if (fingerprint(restoredPlans) !== fingerprint(originalPlans)) throw new Error('El ensayo no conservó íntegramente los planes de agenda.')
    const restoredConfigs = (await pg.query('select config_key, original_payload from normalized_shadow.configuration_evidence order by config_key')).rows
    const originalConfigs = candidate.tables.configuration_evidence.slice().sort((a, b) => a.config_key.localeCompare(b.config_key, 'en'))
    if (fingerprint(restoredConfigs) !== fingerprint(originalConfigs)) throw new Error('El ensayo no conservó íntegramente la configuración.')
    const projectedState = await readNormalizedState(pg)
    const safeSourceState = { ...state, employees: safeEmployees }
    if (fingerprint(projectedState) !== fingerprint(safeSourceState)) {
      const error = new Error('El repositorio normalizado no reconstruyó el estado de aplicación equivalente.')
      error.code = 'NORMALIZED_PROJECTION_MISMATCH'
      error.mismatchPaths = structuralDifferencePaths(safeSourceState, projectedState)
      throw error
    }
    const metrics = (await pg.query("select to_char(work_date, 'YYYY-MM') as month, count(*)::integer as total from normalized_shadow.jobs where status = 'Completado' group by 1 order by 1")).rows
    if (fingerprint(Object.fromEntries(metrics.map(row => [row.month, row.total]))) !== fingerprint(candidate.analysis.summary.completedByMonth)) throw new Error('El ensayo alteró los totales mensuales de trabajos completados.')
    const counts = {}
    for (const table of Object.keys(candidate.tables)) counts[table] = (await pg.query(`select count(*)::integer as total from normalized_shadow.${table}`)).rows[0].total
    if (counts.jobs !== state.history.length || counts.customers !== state.customers.length || counts.agenda_evidence !== candidate.analysis.occurrences.length) throw new Error('El ensayo alteró la cantidad de registros de origen.')
    await pg.exec('commit')
    return { mode: 'isolated-memory-postgres', sourceFingerprint: candidate.analysis.sourceFingerprint, revision: candidate.analysis.revision,
      summary: candidate.analysis.summary, rowCounts: counts, verification: { originalHistoryPreserved: true, catalogEvidencePreserved: true, agendaPlansPreserved: true,
        configurationEvidencePreserved: true, employeeCredentialsExcluded: true, applicationStateProjectionPreserved: true,
        completedMonthlyTotalsPreserved: true, relationalConstraintsPassed: true, schemaIdempotent: true },
      productionModified: false, readyForCutover: false }
  } catch (error) {
    await pg.exec('rollback').catch(() => {})
    throw error
  } finally { await pg.close() }
}
module.exports = { buildShadowCandidate, insertShadowCandidate, rehearseNormalization }
