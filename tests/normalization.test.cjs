const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { analyzeNormalization, fingerprint } = require('../api/_lib/normalization-analysis.cjs')
const { buildShadowCandidate, rehearseNormalization } = require('../api/_lib/normalization-rehearsal.cjs')

function fixture() {
  const job = { id: 'job-1', sourceTaskId: 'task-1', date: '2026-08-25', time: '09:00', estimatedMinutes: 60, status: 'Completado', customerId: 'customer-1', serviceId: 'service-1', teamId: 'team-1', technicianIds: ['employee-1'], technicians: ['Técnico'], detail: 'Original', internalNote: 'Conservar', installationZone: 'docta' }
  return { revision: 123, roles: [{ id: 'role-1', name: 'Técnico' }], employees: [{ id: 'employee-1', roleId: 'role-1', name: 'Técnico', passwordHash: 'MUST-NOT-EXPORT' }],
    customers: [{ customerId: 'customer-1', account: 'PIG-1', name: 'Cliente privado' }], services: [{ id: 'service-1', code: 'alarm-installation', name: 'Instalación', estimatedMinutes: 60 }], vehicles: [{ id: 'vehicle-1', plate: 'AAA111' }],
    history: [job], agenda: { date: '2026-08-25', teams: [], weekly: { '2026-08-25': { teams: [{ teamId: 'team-1', memberIds: ['employee-1'], tasks: [{ ...job, id: undefined, taskId: 'task-1', historyId: 'job-1' }] }] } } }, reviews: [], preferences: { theme: 'light' } }
}

test('analysis is deterministic, read-only and reports unknown historical timestamps without inventing them', () => {
  const state = fixture(), before = fingerprint(state)
  const first = analyzeNormalization(state), second = analyzeNormalization(structuredClone(state))
  assert.equal(fingerprint(state), before)
  assert.deepEqual(first, second)
  assert.equal(first.summary.byType.unknown_completion_timestamp, 1)
  assert.equal(first.summary.requiresReconciliation, false)
  assert.equal(first.summary.readyForCutover, false)
  const candidate = buildShadowCandidate(state)
  assert.equal(candidate.tables.jobs[0].completed_at, null)
  assert.ok(!JSON.stringify(candidate.tables.employees).includes('MUST-NOT-EXPORT'))
  assert.ok(!JSON.stringify(first.issues).includes('Cliente privado'))
})
test('one record copied to another day remains one job and produces stable review cases', () => {
  const state = fixture()
  state.agenda.weekly['2026-08-26'] = structuredClone(state.agenda.weekly['2026-08-25'])
  state.agenda.weekly['2026-08-26'].teams[0].tasks[0].status = 'Pendiente'
  const candidate = buildShadowCandidate(state)
  assert.equal(candidate.tables.jobs.length, 1)
  assert.equal(candidate.tables.agenda_evidence.length, 2)
  assert.equal(candidate.analysis.summary.byType.date_mismatch, 1)
  assert.equal(candidate.analysis.summary.byType.status_mismatch, 1)
  assert.equal(candidate.analysis.summary.byType.multiple_weekly_dates, 1)
  assert.equal(candidate.tables.jobs[0].status, 'Completado')
  assert.equal(candidate.tables.jobs[0].needs_review, true)
  assert.equal(candidate.analysis.summary.requiresReconciliation, true)
})
test('unlinked real services, vehicle templates and empty slots are not silently imported as jobs', () => {
  const state = fixture()
  state.agenda.weekly['2026-08-25'].teams[0].tasks.push(
    { taskId: 'empty', time: '11:00' },
    { taskId: 'draft', serviceId: 'service-1', client: 'Pending' },
    { taskId: 'control', historyId: 'missing', serviceId: 'service-1', vehicleControl: true }
  )
  const candidate = buildShadowCandidate(state)
  assert.equal(candidate.tables.jobs.length, 1)
  assert.equal(candidate.analysis.summary.byType.unregistered_service, 1)
  assert.equal(candidate.analysis.summary.byType.unregistered_vehicle_control, 1)
  assert.equal(candidate.analysis.summary.byType.dangling_history_link, 1)
  assert.equal(candidate.tables.agenda_evidence.length, 4)
})
test('orphan references and duplicate record IDs stop import instead of removing records', () => {
  const state = fixture()
  state.history.push({ ...state.history[0] })
  state.history[0].customerId = 'missing'
  assert.equal(analyzeNormalization(state).summary.bySeverity.error > 0, true)
  assert.throws(() => buildShadowCandidate(state), { code: 'NORMALIZATION_INTEGRITY_ERRORS' })
  assert.equal(state.history.length, 2)
})
test('different team memberships are not resolved by inventing a union of technicians', () => {
  const state = fixture()
  state.employees.push({ id: 'employee-2', roleId: 'role-1', name: 'Segundo' })
  state.history.push({ ...state.history[0], id: 'job-2', sourceTaskId: 'task-2', time: '12:00', technicianIds: ['employee-2'] })
  const candidate = buildShadowCandidate(state)
  assert.equal(candidate.analysis.summary.byType.team_membership_conflict, 1)
  assert.equal(candidate.tables.daily_teams[0].membership_resolved, false)
  assert.equal(candidate.tables.team_members.length, 0)
  assert.deepEqual(candidate.tables.service_assignments.map(row => row.employee_id), ['employee-1', 'employee-2'])
})
test('legacy missing task identities remain null, never synthesized as factual identifiers', () => {
  const state = fixture()
  delete state.history[0].sourceTaskId
  assert.equal(buildShadowCandidate(state).tables.jobs[0].source_task_id, null)
  assert.equal(analyzeNormalization(state).summary.byType.legacy_missing_task_id, 1)
})
test('vehicle controls are normalized as job subtypes with one responsible technician', () => {
  const state = fixture()
  state.services.push({ id: 'vehicle-weekly-control', code: 'vehicle-weekly-control', name: 'Control semanal', estimatedMinutes: 15 })
  state.history.push({ id: 'control-1', sourceTaskId: 'control-1', date: '2026-08-25', time: '15:30', estimatedMinutes: 15, status: 'Pendiente',
    serviceId: 'vehicle-weekly-control', teamId: 'team-1', technicianIds: ['employee-1'], vehicleControl: true, vehicleId: 'vehicle-1', vehicleControlScheduledFriday: '2026-08-25' })
  const candidate = buildShadowCandidate(state)
  assert.equal(candidate.tables.jobs.find(row => row.id === 'control-1').job_kind, 'vehicle_control')
  assert.deepEqual(candidate.tables.vehicle_controls, [{ job_id: 'control-1', vehicle_id: 'vehicle-1', scheduled_friday: '2026-08-25', mileage_at_scheduling: null, reported_mileage: null,
    vehicle_brand_snapshot: null, vehicle_model_snapshot: null, vehicle_plate_snapshot: null }])
  state.history[1].technicianIds = []
  assert.equal(analyzeNormalization(state).summary.byType.invalid_vehicle_control_assignment, 1)
})
test('PostgreSQL rehearsal preserves original history and monthly completion totals', async () => {
  const state = fixture(), before = fingerprint(state)
  const result = await rehearseNormalization(state)
  assert.equal(result.rowCounts.jobs, 1)
  assert.equal(result.rowCounts.service_assignments, 1)
  assert.equal(result.productionModified, false)
  assert.equal(result.readyForCutover, false)
  assert.equal(result.verification.originalHistoryPreserved, true)
  assert.equal(result.verification.completedMonthlyTotalsPreserved, true)
  assert.equal(fingerprint(state), before)
})
test('shadow schema enforces foreign keys, valid durations, unique identities and non-public access', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    await assert.rejects(pg.query("insert into normalized_shadow.employees (id, role_id, name) values ('e','missing','Name')"), { code: '23503' })
    await assert.rejects(pg.query("insert into normalized_shadow.service_types (id, code, name, estimated_minutes) values ('s','s','Service',0)"), { code: '23514' })
    await pg.exec("insert into normalized_shadow.customers (id, account, name) values ('a','CLI-1','First')")
    await assert.rejects(pg.query("insert into normalized_shadow.customers (id, account, name) values ('b','CLI-1','Second')"), { code: '23505' })
    await pg.exec("create role anon; set role anon")
    await assert.rejects(pg.query('select * from normalized_shadow.customers'), { code: '42501' })
  } finally { await pg.close() }
})
