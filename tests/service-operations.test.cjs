const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { recordChanges } = require('../api/_lib/record-changes.cjs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const { replaceCollections } = require('../api/_lib/database.cjs')
const { stateForOperationComparison } = require('../api/_lib/legacy-estimated-minutes.cjs')
const day = '2096-09-11'
const clone = structuredClone
const fixture = () => ({
  history: Array.from({ length: 581 }, (_, index) => ({ id: `work-${index}`, teamId: `team-${index % 39}`, sourceTaskId: `task-${index}`, status: 'Pendiente', detail: 'original' })),
  customers: [], services: [], roles: [], employees: [], reviews: [], vehicles: [], preferences: { theme: 'light' },
  agenda: { date: day, teams: [], weekly: { [day]: { teams: [{ teamId: 'team-1', memberIds: ['tech-1'], members: ['Técnico 1'], tasks: [] }] } } }
})
const builder = () => import('../src/features/state/application/state-operations.mjs')
const weeklyBuilder = () => import('../src/features/state/application/weekly-service-save.mjs')
const weeklyTeamBuilder = () => import('../src/features/state/application/weekly-team-members-save.mjs')
test('581 records / 39 teams: independent edits send and persist exactly one record each', async () => {
  const { stateOperations } = await builder()
  const base = fixture(), a = clone(base), b = clone(base)
  a.history[3].status = 'Completado'
  b.history[81].detail = 'otra sesión'
  const opA = stateOperations(base, a), opB = stateOperations(base, b)
  assert.equal(opA.length, 1); assert.equal(opB.length, 1)
  assert.ok(JSON.stringify(opA).length < 500)
  const saved = applyStateOperations(applyStateOperations(base, opA), opB)
  assert.equal(saved.history.length, 581)
  assert.equal(saved.history[3].status, 'Completado')
  assert.equal(saved.history[81].detail, 'otra sesión')
  assert.equal(recordChanges(base.history, saved.history).changed.length, 2)
})
test('same record conflicts even if different fields changed; retries are idempotent', async () => {
  const { stateOperations } = await builder()
  const base = fixture(), a = clone(base), b = clone(base)
  a.history[0].status = 'Completado'; b.history[0].detail = 'otro borrador'
  const operations = stateOperations(base, a), saved = applyStateOperations(base, operations)
  assert.deepEqual(applyStateOperations(saved, operations), saved)
  assert.throws(() => applyStateOperations(saved, stateOperations(base, b)), { code: 'RECORD_WRITE_CONFLICT' })
  assert.equal(base.history[0].status, 'Pendiente')
})
test('un servicio legado se compara con la misma duración que muestra el navegador', async () => {
  const { stateOperations } = await builder()
  const stored = fixture()
  const legacyRecord = { id: 'work-legacy', sourceTaskId: 'task-legacy', service: 'Service', serviceId: 's', address: 'Anterior' }
  const legacyTask = { taskId: 'task-legacy', historyId: 'work-legacy', service: 'Service', serviceId: 's', address: 'Anterior' }
  stored.history.push(legacyRecord)
  stored.agenda.weekly[day].teams[0].tasks.push(legacyTask)
  const browserBase = stateForOperationComparison(stored)
  const edited = clone(browserBase)
  edited.history.find(record => record.id === 'work-legacy').address = 'Actualizada'
  edited.agenda.weekly[day].teams[0].tasks.find(task => task.taskId === 'task-legacy').address = 'Actualizada'

  const operations = stateOperations(browserBase, edited)
  assert.throws(() => applyStateOperations(stored, operations), { code: 'RECORD_WRITE_CONFLICT' })
  const saved = applyStateOperations(stateForOperationComparison(stored), operations)

  assert.equal(saved.history.find(record => record.id === 'work-legacy').address, 'Actualizada')
  assert.equal(saved.agenda.weekly[day].teams[0].tasks.find(task => task.taskId === 'task-legacy').address, 'Actualizada')
})
test('un guardado pendiente y la edición del modal se aplican en una sola transacción', async () => {
  const { stateOperations } = await builder()
  const { weeklyServiceOperations } = await weeklyBuilder()
  const stored = fixture()
  const legacyRecord = { id: 'work-pending', sourceTaskId: 'task-pending', service: 'Service', serviceId: 's', status: 'Pendiente', address: '-', phone: '-', technicianIds: ['tech-1'], technicians: ['Técnico 1'], estimatedMinutes: 60, estimatedMinutesCustomized: false }
  const legacyTask = { taskId: 'task-pending', historyId: 'work-pending', service: 'Service', serviceId: 's', status: 'Pendiente', address: '-', phone: '-', estimatedMinutes: 60, estimatedMinutesCustomized: false }
  stored.history.push(legacyRecord)
  stored.agenda.weekly[day].teams[0].memberIds = ['tech-1', 'tech-2']
  stored.agenda.weekly[day].teams[0].members = ['Técnico 1', 'Técnico 2']
  stored.agenda.weekly[day].teams[0].tasks.push(legacyTask)

  const local = stateForOperationComparison(stored)
  const team = local.agenda.weekly[day].teams[0]
  const baseRecord = local.history.find(record => record.id === legacyRecord.id)
  const baseTask = team.tasks.find(task => task.taskId === legacyTask.taskId)
  const task = { ...baseTask, address: 'José Roque Funes 2751', phone: '+54 9 3513 02-0552', paymentMethod: 'Crédito', amount: '320000' }
  const record = { ...baseRecord, ...task, id: baseRecord.id, sourceTaskId: task.taskId, date: day, teamId: team.teamId, technicianIds: team.memberIds, technicians: team.members }
  const commandOperations = weeklyServiceOperations(local, { day, team, task, record, baseRecord, baseTask })

  const directlyCompared = applyStateOperations(stateForOperationComparison(stored), commandOperations)
  assert.equal(directlyCompared.history.find(item => item.id === legacyRecord.id).amount, '320000')
  const saved = applyStateOperations(stored, [...stateOperations(stored, local), ...commandOperations])
  assert.equal(saved.history.find(item => item.id === legacyRecord.id).paymentMethod, 'Crédito')
  assert.equal(saved.history.find(item => item.id === legacyRecord.id).amount, '320000')
  assert.deepEqual(saved.history.find(item => item.id === legacyRecord.id).technicianIds, ['tech-1', 'tech-2'])
  assert.equal(saved.agenda.weekly[day].teams[0].tasks.find(item => item.taskId === legacyTask.taskId).address, 'José Roque Funes 2751')
})
test('deleting one record preserves every concurrent insertion', async () => {
  const { stateOperations } = await builder()
  const base = fixture(), deletion = clone(base), insertion = clone(base)
  deletion.history.splice(3, 1); insertion.history.push({ id: 'new' })
  const saved = applyStateOperations(applyStateOperations(base, stateOperations(base, insertion)), stateOperations(base, deletion))
  assert.equal(saved.history.length, 581); assert.ok(saved.history.some(item => item.id === 'new'))
  assert.ok(!saved.history.some(item => item.id === 'work-3'))
})
const command = (snapshot, id, time = '09:00') => {
  const team = snapshot.agenda.weekly[day].teams[0]
  const task = { taskId: id, historyId: `work-${id}`, service: 'Service', serviceId: 's', time, estimatedMinutes: 60, status: 'Pendiente', client: 'QA', detail: 'QA' }
  return { day, team, task, record: { ...task, id: task.historyId, sourceTaskId: id, date: day, teamId: team.teamId, technicianIds: team.memberIds, technicians: team.members }, baseRecord: null }
}
test('modal creates future history and projections in one atomic operation, without day Save', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const base = fixture(), input = command(base, 'new')
  const operations = weeklyServiceOperations(base, input)
  const saved = applyStateOperations(base, operations)
  assert.equal(saved.history.at(-1).status, 'Pendiente')
  assert.equal(saved.history.at(-1).date, day)
  assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].historyId, 'work-new')
  assert.equal(saved.agenda.teams[0].tasks[0].taskId, 'new')
  assert.equal(base.history.length, 581)
})
test('weekly reassignment moves one service to another date and updates history atomically', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const original = command(fixture(), 'move-date', '11:00')
  const base = applyStateOperations(fixture(), weeklyServiceOperations(fixture(), original))
  base.agenda.teams = structuredClone(base.agenda.weekly[day].teams)
  const destinationDay = '2096-09-12'
  const destinationTeam = { teamId: 'team-destination', memberIds: ['tech-2'], members: ['Técnico 2'], tasks: [] }
  base.agenda.weekly[destinationDay] = { teams: [destinationTeam] }
  const baseRecord = base.history.find(item => item.id === original.record.id)
  const movedTask = { ...original.task, status: 'Pendiente' }
  const record = { ...baseRecord, date: destinationDay, teamId: destinationTeam.teamId, team: 'Equipo 1', technicianIds: destinationTeam.memberIds, technicians: destinationTeam.members, rescheduledFrom: day }
  const operations = weeklyServiceOperations(base, { day: destinationDay, team: destinationTeam, task: movedTask, record, baseRecord, baseTask: original.task, sourceDay: day, sourceTeamId: original.team.teamId })
  const saved = applyStateOperations(base, operations)
  assert.equal(saved.agenda.weekly[day].teams[0].tasks.length, 0)
  assert.equal(saved.agenda.weekly[destinationDay].teams[0].tasks[0].taskId, 'move-date')
  assert.equal(saved.agenda.teams[0].tasks.length, 0)
  assert.equal(saved.history.find(item => item.id === record.id).date, destinationDay)
  assert.equal(saved.history.length, 582)
})
test('weekly reassignment keeps same-day team moves atomic', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const original = command(fixture(), 'move-team', '11:00')
  const base = applyStateOperations(fixture(), weeklyServiceOperations(fixture(), original))
  const destinationTeam = { teamId: 'team-2', memberIds: ['tech-2'], members: ['Técnico 2'], tasks: [] }
  base.agenda.weekly[day].teams.push(destinationTeam)
  base.agenda.teams = structuredClone(base.agenda.weekly[day].teams)
  const baseRecord = base.history.find(item => item.id === original.record.id)
  const record = { ...baseRecord, teamId: destinationTeam.teamId, team: 'Equipo 2', technicianIds: destinationTeam.memberIds, technicians: destinationTeam.members }
  const move = weeklyServiceOperations(base, { day, team: destinationTeam, task: original.task, record, baseRecord, baseTask: original.task, sourceDay: day, sourceTeamId: original.team.teamId })
  const saved = applyStateOperations(base, move)
  assert.deepEqual(saved.agenda.weekly[day].teams.map(team => team.tasks.map(task => task.taskId)), [[], ['move-team']])
  assert.deepEqual(saved.agenda.teams.map(team => team.tasks.map(task => task.taskId)), [[], ['move-team']])
  assert.equal(saved.history.find(item => item.id === record.id).teamId, 'team-2')
})
test('weekly team membership changes do not rewrite services or vehicle controls', async () => {
  const { weeklyTeamMemberOperations } = await weeklyTeamBuilder()
  const base = fixture()
  const control = { taskId: 'vehicle-control', historyId: 'vehicle-control', service: 'Control semanal de vehículo', time: '15:30', vehicleControl: true, status: 'Pendiente' }
  base.agenda.weekly[day].teams[0] = { teamId: 'team-1', memberIds: ['tech-1', 'tech-2'], members: ['Técnico 1', 'Técnico 2'], tasks: [control] }
  const operations = weeklyTeamMemberOperations(base, {
    operation: 'team-members', day, teamId: 'team-1', teamIndex: 0,
    baseMemberIds: ['tech-1', 'tech-2'], baseMembers: ['Técnico 1', 'Técnico 2'],
    memberIds: ['tech-1'], members: ['Técnico 1'], fallbackPlan: base.agenda.weekly[day]
  })
  assert.deepEqual(operations.map(operation => operation.path.at(-1)).sort(), ['memberIds', 'members'])
  assert.doesNotMatch(JSON.stringify(operations), /createdBy|vehicle-control/)
  const saved = applyStateOperations(base, operations)
  assert.deepEqual(saved.agenda.weekly[day].teams[0].memberIds, ['tech-1'])
  assert.deepEqual(saved.agenda.weekly[day].teams[0].tasks, [control])
})
test('a weekly membership change coexists with a concurrent service edit but conflicts on the same crew', async () => {
  const { weeklyTeamMemberOperations } = await weeklyTeamBuilder()
  const base = fixture()
  base.agenda.weekly[day].teams[0] = { teamId: 'team-1', memberIds: ['tech-1', 'tech-2'], members: ['Técnico 1', 'Técnico 2'], tasks: [{ taskId: 'task-1', service: 'Service', detail: 'original' }] }
  const command = {
    operation: 'team-members', day, teamId: 'team-1', teamIndex: 0,
    baseMemberIds: ['tech-1', 'tech-2'], baseMembers: ['Técnico 1', 'Técnico 2'],
    memberIds: ['tech-1'], members: ['Técnico 1'], fallbackPlan: base.agenda.weekly[day]
  }
  const current = clone(base)
  current.agenda.weekly[day].teams[0].tasks[0].detail = 'editado en simultáneo'
  const saved = applyStateOperations(current, weeklyTeamMemberOperations(base, command))
  assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].detail, 'editado en simultáneo')
  assert.deepEqual(saved.agenda.weekly[day].teams[0].members, ['Técnico 1'])
  const conflicting = clone(base)
  conflicting.agenda.weekly[day].teams[0].memberIds = ['tech-2']
  conflicting.agenda.weekly[day].teams[0].members = ['Técnico 2']
  assert.throws(() => applyStateOperations(conflicting, weeklyTeamMemberOperations(base, command)), { code: 'RECORD_WRITE_CONFLICT' })
})
test('cross-day reassignment preserves services concurrently added at source and destination', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const original = command(fixture(), 'move-concurrent', '09:00')
  const base = applyStateOperations(fixture(), weeklyServiceOperations(fixture(), original))
  const destinationDay = '2096-09-12'
  const destinationTeam = { teamId: 'team-destination', memberIds: ['tech-2'], members: ['Técnico 2'], tasks: [] }
  base.agenda.weekly[destinationDay] = { teams: [destinationTeam] }
  const destinationCommand = { ...command(base, 'destination-peer', '13:00'), day: destinationDay, team: destinationTeam }
  destinationCommand.record = { ...destinationCommand.record, date: destinationDay, teamId: destinationTeam.teamId }
  const current = applyStateOperations(
    applyStateOperations(base, weeklyServiceOperations(base, command(base, 'source-peer', '11:00'))),
    weeklyServiceOperations(base, destinationCommand)
  )
  const baseRecord = base.history.find(item => item.id === original.record.id)
  const record = { ...baseRecord, date: destinationDay, teamId: destinationTeam.teamId, technicianIds: destinationTeam.memberIds, technicians: destinationTeam.members }
  const move = weeklyServiceOperations(base, { day: destinationDay, team: destinationTeam, task: original.task, record, baseRecord, baseTask: original.task, sourceDay: day, sourceTeamId: original.team.teamId })
  const saved = applyStateOperations(current, move)
  assert.deepEqual(saved.agenda.weekly[day].teams[0].tasks.map(task => task.taskId), ['source-peer'])
  assert.deepEqual(saved.agenda.weekly[destinationDay].teams[0].tasks.map(task => task.taskId).sort(), ['destination-peer', 'move-concurrent'])
})
test('two users add different services on the same day without replacing each other', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const base = fixture()
  const a = weeklyServiceOperations(base, command(base, 'a', '09:00'))
  const b = weeklyServiceOperations(base, command(base, 'b', '11:00'))
  const saved = applyStateOperations(applyStateOperations(base, a), b)
  assert.equal(saved.history.length, 583)
  assert.equal(saved.agenda.weekly[day].teams[0].tasks.length, 2)
  assert.equal(saved.agenda.teams[0].tasks.length, 2)
  validateChangedAgendaSchedules(saved, base)
})
test('server detects overlap against the other session; transaction candidate does not mutate stored data', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const base = fixture()
  const current = applyStateOperations(base, weeklyServiceOperations(base, command(base, 'a', '09:00')))
  const candidate = applyStateOperations(current, weeklyServiceOperations(base, command(base, 'b', '09:30')))
  assert.throws(() => validateChangedAgendaSchedules(candidate, current), /conflicto de horarios/)
  assert.equal(current.history.length, 582)
  assert.equal(current.agenda.weekly[day].teams[0].tasks.length, 1)
})
test('deleting a team cannot erase a service added by another session', async () => {
  const { stateOperations } = await builder(), { weeklyServiceOperations } = await weeklyBuilder()
  const base = fixture(), deletion = clone(base)
  deletion.agenda.weekly[day].teams = []
  const current = applyStateOperations(base, weeklyServiceOperations(base, command(base, 'new')))
  assert.throws(() => applyStateOperations(current, stateOperations(base, deletion)), { code: 'TEAM_HAS_SERVICES' })
  assert.equal(current.agenda.weekly[day].teams[0].tasks.length, 1)
})
test('edits cannot recreate a team deleted after the modal opened', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const base = fixture(), current = clone(base)
  current.agenda.weekly[day].teams = []
  assert.throws(() => applyStateOperations(current, weeklyServiceOperations(base, command(base, 'new'))), { code: 'RECORD_WRITE_CONFLICT' })
})
test('moving a service preserves concurrent additions in both teams', async () => {
  const { stateOperations } = await builder(), { weeklyServiceOperations } = await weeklyBuilder()
  const base = applyStateOperations(fixture(), weeklyServiceOperations(fixture(), command(fixture(), 'a')))
  base.agenda.weekly[day].teams.push({ teamId: 'team-2', memberIds: ['tech-2'], members: ['Técnico 2'], tasks: [] })
  const moved = clone(base)
  const task = moved.agenda.weekly[day].teams[0].tasks.shift()
  moved.agenda.weekly[day].teams[1].tasks.push(task)
  moved.history.find(item => item.id === task.historyId).teamId = 'team-2'
  const current = applyStateOperations(base, weeklyServiceOperations(base, command(base, 'b', '11:00')))
  const saved = applyStateOperations(current, stateOperations(base, moved))
  assert.deepEqual(saved.agenda.weekly[day].teams.map(team => team.tasks.map(task => task.taskId)), [['b'], ['a']])
  assert.equal(saved.history.length, 583)
})
test('a technician-only reassignment revalidates overlaps between teams', () => {
  const before = fixture()
  before.agenda.weekly[day].teams = [
    { teamId: 'a', memberIds: ['one'], members: ['Uno'], tasks: [{ taskId: 'a', service: 'Service', time: '09:00', estimatedMinutes: 60 }] },
    { teamId: 'b', memberIds: ['two'], members: ['Dos'], tasks: [{ taskId: 'b', service: 'Service', time: '09:30', estimatedMinutes: 60 }] }
  ]
  const next = clone(before)
  next.agenda.weekly[day].teams[1].memberIds = ['one']; next.agenda.weekly[day].teams[1].members = ['Uno']
  assert.throws(() => validateChangedAgendaSchedules(next, before), /servicios incompatibles/)
})
test('a removed team cannot be resurrected even after refreshing a pending modal', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const original = fixture(), commandBeforeDelete = command(original, 'new'), current = fixture()
  current.agenda.weekly[day] = { teams: [], removedTeams: [{ teamId: 'team-1' }] }
  assert.throws(() => applyStateOperations(current, weeklyServiceOperations(current, commandBeforeDelete)), { code: 'RECORD_WRITE_CONFLICT' })
})
test('conflicting history edit rolls back task changes in the candidate', async () => {
  const { weeklyServiceOperations } = await weeklyBuilder()
  const base = fixture(), input = command(base, 'new')
  input.record.id = 'work-0'; input.task.historyId = 'work-0'; input.baseRecord = base.history[0]
  const current = clone(base); current.history[0].status = 'Completado'
  assert.throws(() => applyStateOperations(current, weeklyServiceOperations(base, input)), { code: 'RECORD_WRITE_CONFLICT' })
  assert.deepEqual(current.agenda.weekly[day].teams[0].tasks, [])
})
test('operation paths reject prototype pollution, altered identities and numeric array positions', () => {
  const op = { path: ['agenda', '__proto__'], existed: false, exists: true, before: null, after: {} }
  assert.throws(() => applyStateOperations(fixture(), [op]), /inválida/)
  assert.throws(() => applyStateOperations(fixture(), [{ ...op, path: ['history', '0'] }]), /identificador/)
  assert.throws(() => applyStateOperations(fixture(), [{ ...op, path: ['history', { key: 'id', id: 'new' }], after: { id: 'wrong' } }]), /identidad/)
  assert.equal({}.polluted, undefined)
})
test('Postgres save touches only the changed history row and does not clear tables', async () => {
  const before = fixture(), next = clone(before), statements = []
  next.history[8].detail = 'edición'
  const sql = (strings, ...values) => {
    if (!Array.isArray(strings) || !strings.raw) return { records: strings }
    statements.push({ query: strings.join('?'), values }); return Promise.resolve([])
  }
  sql.json = value => value
  await replaceCollections(sql, next, before)
  assert.equal(statements.length, 1)
  assert.match(statements[0].query, /insert into pignus_work_history.*on conflict/s)
  assert.equal(statements[0].values[0].records.length, 1)
  assert.equal(statements[0].values[0].records[0].id, 'work-8')
})
