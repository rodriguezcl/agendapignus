const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const day = '2026-09-21'
const team = { teamId: 'monthly-1', label: 'Equipo 1', memberIds: ['rodrigo', 'pascual'], members: ['Rodrigo', 'Pascual'], tasks: [{ taskId: 'empty-1', time: '08:45' }] }
const command = () => ({ day, teamId: team.teamId, teamIndex: 0, baseMemberIds: team.memberIds, baseMembers: team.members, memberIds: ['pascual'], members: ['Pascual'], materializeTeam: true, fallbackPlan: { teams: [structuredClone(team)] } })
const snapshot = plan => ({ history: [], agenda: { date: '2026-09-18', teams: [], weekly: { _monthlyTeams: { '2026-09': { teams: [structuredClone(team)] } }, [day]: plan, '2026-09-22': { teams: [structuredClone(team)] } } } })
const builder = async () => (await import('../src/features/state/application/weekly-team-members-save.mjs')).weeklyTeamMemberOperations

test('removing Rodrigo materializes only Monday, preserving monthly and Tuesday assignments', async () => {
  const build = await builder()
  const base = snapshot({ teams: [], holidayDecision: { status: 'working' } })
  const before = structuredClone(base)
  const saved = applyStateOperations(base, build(base, command()))
  assert.deepEqual(saved.agenda.weekly[day].teams[0].members, ['Pascual'])
  assert.deepEqual(saved.agenda.weekly[day].teams[0].tasks, team.tasks)
  assert.deepEqual(saved.agenda.weekly[day].holidayDecision, base.agenda.weekly[day].holidayDecision)
  assert.deepEqual(saved.agenda.weekly._monthlyTeams, base.agenda.weekly._monthlyTeams)
  assert.deepEqual(saved.agenda.weekly['2026-09-22'], base.agenda.weekly['2026-09-22'])
  assert.deepEqual(saved.agenda.teams, [])
  assert.deepEqual(base, before)
})

test('partial day never changes a different team at the same array index', async () => {
  const build = await builder()
  const other = { teamId: 'monthly-2', members: ['Mariano'], memberIds: ['mariano'], tasks: [{ taskId: 'saved', detail: 'Original' }] }
  const base = snapshot({ teams: [other] })
  const current = structuredClone(base)
  current.agenda.weekly[day].teams[0].tasks[0].detail = 'Cambio concurrente'
  const saved = applyStateOperations(current, build(base, command()))
  assert.deepEqual(saved.agenda.weekly[day].teams[0], current.agenda.weekly[day].teams[0])
  assert.deepEqual(saved.agenda.weekly[day].teams[1].members, ['Pascual'])
})

test('previously persisted missing team is not recreated and removed defaults stay removed', async () => {
  const build = await builder()
  assert.throws(() => build(snapshot({ teams: [] }), { ...command(), materializeTeam: false }), /equipo cambió/)
  for (const marker of [{ teamId: team.teamId }, { teamNumber: 1 }]) {
    assert.throws(() => build(snapshot({ teams: [], removedTeams: [marker] }), command()), /equipo cambió/)
  }
  const base = snapshot({ teams: [] })
  const current = structuredClone(base)
  current.agenda.weekly[day].removedTeams = [{ teamId: team.teamId }]
  assert.throws(() => applyStateOperations(current, build(base, command())), { code: 'RECORD_WRITE_CONFLICT' })
})

test('new day still supports membership exceptions and retries are idempotent', async () => {
  const build = await builder()
  const base = snapshot(undefined)
  delete base.agenda.weekly[day]
  const operations = build(base, command())
  const saved = applyStateOperations(base, operations)
  assert.deepEqual(saved.agenda.weekly[day].teams[0].members, ['Pascual'])
  assert.deepEqual(applyStateOperations(saved, operations), saved)
})

test('daily membership sync uses team identity rather than changing another team', async () => {
  const build = await builder()
  const base = snapshot({ teams: [] })
  base.agenda.date = day
  base.agenda.teams = [{ teamId: 'other', members: ['Santos'], memberIds: ['santos'], tasks: [] }, structuredClone(team)]
  const saved = applyStateOperations(base, build(base, command()))
  assert.deepEqual(saved.agenda.teams[0], base.agenda.teams[0])
  assert.deepEqual(saved.agenda.teams[1].members, ['Pascual'])
})
