const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const start = source.indexOf("  const addTask = (day, teamIndex, startTime = '')")
const code = source.slice(start, source.indexOf('  const removeWeeklyTask', start))
for (const persisted of [true, false]) {
  test(`availability editor retains team and task identity (persisted=${persisted})`, () => {
    const day = '2026-09-18'
    let plan = { teams: [{ teamId: 'pascual-team', label: 'Equipo 1', members: ['Pascual'], memberIds: ['pascual'], tasks: [{ taskId: 'previous', time: '08:45' }] }] }
    let editor
    const add = vm.runInNewContext(code + '\naddTask', {
      structuredClone, dayHasFinished: () => false, holidayStateForDay: () => ({ blocked: false }), advancedGuardForDay: () => null,
      blankTask: () => ({ taskId: 'new-task' }), dayPlan: () => plan,
      weekly: persisted ? { [day]: structuredClone(plan) } : {},
      updateDay: (_, mutate) => { plan = mutate(plan) },
      setTaskEditor: value => { editor = value }, setNotice: message => { throw new Error(message) }
    })
    add(day, 0, '11:30')
    assert.equal(editor.teamId, 'pascual-team')
    assert.equal(editor.teamSnapshot.members[0], 'Pascual')
    assert.equal(editor.persistedTeam, persisted)
    assert.equal(editor.taskId, editor.draft.taskId)
    assert.equal(editor.taskId, 'new-task')
    assert.equal(editor.draft.time, '11:30')
    assert.equal(plan.teams[0].tasks.length, 2)
    assert.equal(plan.teams[0].tasks.filter(task => task.taskId !== editor.taskId).length, 1)
    plan.teams[0].members.push('Otro')
    assert.equal(editor.teamSnapshot.members.length, 1)
  })
}
