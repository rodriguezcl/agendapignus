const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const daily = source.slice(source.indexOf('function AgendaWorkspaceForm('), source.indexOf('function WeeklyPlanner('))

test('daily individual save selects one task and persists history and planning together', () => {
  assert.match(daily, /team.tasks.filter\(task => !onlyTaskId \|\| task.taskId === onlyTaskId\)/)
  assert.match(daily, /await persistWeeklyService\(\{ day: date, team, task:/)
  assert.match(daily, /record.team = `Equipo \$\{teams.indexOf\(team\) \+ 1\}`/)
  assert.match(daily, /validateAgenda\(agendaTeams, onlyTaskId\)/)
  assert.match(daily, /if \(!team\?\.members\?\.length/)
})
test('save is above copy and hidden after history confirms the service', () => {
  const actions = daily.slice(daily.indexOf('<div className="daily-task-actions">'))
  assert.ok(actions.indexOf('daily-save-button') < actions.indexOf('daily-copy-button'))
  assert.match(actions, /!historyRecordForTask\(task, date, history\) && <button/)
  assert.match(daily, /if \(singleSaveRef.current\) return false/)
})
test('module navigation waits for successful saves and excludes empty cards', () => {
  assert.match(daily, /taskHasContent\(task\) && !historyRecordForTask/)
  assert.match(daily, /if \(await saveDailyService\(first.task.taskId\)\) setDailyResume\(request\)/)
  for (const component of ['AgendaLayout', 'AgendaWorkspace', 'AgendaWorkspaceForm']) {
    assert.ok(source.includes(`<${component} navigationGuardRef={navigationGuardRef}`))
  }
})
