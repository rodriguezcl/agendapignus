const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/App.jsx'), 'utf8')

test('weekly cards keep service identity and reports without management shortcuts', () => {
  const start = source.indexOf('<div className="week-task-title">')
  const title = source.slice(start, source.indexOf('<TaskStatusBadge', start))
  assert.match(title, /week-task-hour/)
  assert.match(title, /week-task-client/)
  assert.doesNotMatch(title, /<button|ServiceConfirmationButton|ServiceJourneys|week-task-title-actions/)
})

test('service actions are above the weekly editor form and not duplicated in its footer', () => {
  assert.match(source, /weeklyModalActions\(taskEditor\)\}<div className="weekly-task-form"/)
  assert.doesNotMatch(source, /className="modal-actions"><ServiceConfirmationButton task=\{task\} day=\{day\}/)
  const toolbar = source.slice(source.indexOf('const weeklyModalActions'), source.indexOf('const openWeeklyTaskMove'))
  for (const action of ['ServiceConfirmationButton', 'ServiceJourneys', 'Reasignar equipo o fecha', 'Eliminar servicio']) assert.ok(toolbar.includes(action))
  assert.match(toolbar, /requestWeeklyLeave\(proceed\)/)
  assert.match(toolbar, /!persistedTask.vehicleControl \|\| isAdministrator/)
  assert.match(toolbar, /!taskIsResolvedForPlanning/)
  assert.match(toolbar, /String\(task.taskId\) === String\(taskId\)/)
})

test('read-only service modals retain their permitted actions', () => {
  assert.match(source, /actions=\{weeklyServiceSource && weeklyModalActions\(weeklyServiceSource, true\)\}/)
  assert.match(source, /<h2>\{pastService.client \|\| pastService.service\}<\/h2>\{weeklyServiceSource && weeklyModalActions/)
})
