const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')

test('automatic reschedule repair does not recreate a removed monthly team', () => {
  const helpers = source.slice(source.indexOf('const removedWeeklyTeamMatches ='), source.indexOf('const renumberVisibleWeeklyTeams ='))
  const move = source.slice(source.indexOf('const moveRecordInWeeklyAgenda ='), source.indexOf('const blankEmployee'))
  let id = 0
  const repair = vm.runInNewContext(`${helpers}\n${move}\nmoveRecordInWeeklyAgenda`, {
    isSaturday: () => false, createTeamId: () => `team-${++id}`,
    teamLabelNumber: team => Number(team.label?.match(/\d+/)?.[0]),
    defaultServiceTasksForDate: () => [{ taskId: `blank-${++id}`, time: '09:00' }],
    defaultServiceTimesForDate: () => ['09:00'], fallbackDefaultServiceTimesForDate: () => ['09:00'],
    alignDefaultServiceTimes: teams => teams,
    mergeStoredTeamsWithDefaults: (defaults, stored) => defaults.map(team => stored.find(item => item.teamId === team.teamId) || team),
    rescheduledAgendaTask: record => ({ taskId: record.sourceTaskId, historyId: record.id, time: record.time }),
    sortTasksByTime: tasks => tasks
  })
  const day = '2026-09-28'
  const team = { teamId: 'active', label: 'Equipo 1', tasks: [] }
  const weekly = {
    _monthlyTeams: { '2026-09': { teams: [team, { teamId: 'removed', label: 'Equipo 3' }] } },
    [day]: { teams: [team], removedTeams: [{ teamId: 'removed', teamNumber: 3 }] }
  }
  const record = { id: 'work', sourceTaskId: 'task', teamId: 'active', team: 'Equipo 1', time: '10:00' }
  let next = weekly
  for (let i = 0; i < 3; i++) {
    next = repair(next, record, day, '2026-09-29')
    assert.deepEqual(Array.from(next[day].teams, item => item.teamId), ['active'])
    assert.equal(next[day].teams[0].tasks.length, 1)
  }
  assert.equal(repair(weekly, { ...record, teamId: 'removed', team: 'Equipo 3' }, day, '2026-09-29'), weekly)
})
