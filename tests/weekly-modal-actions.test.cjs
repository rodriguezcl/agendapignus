const { frontendSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const source = frontendSource()

test('weekly cards keep service identity and reports without management shortcuts', () => {
  const start = source.indexOf('<div className="week-task-title">')
  const title = source.slice(start, source.indexOf('<TaskStatusBadge task={task} date={day} history={operationalHistory} weekly', start))
  assert.match(title, /week-task-hour/)
  assert.match(title, /week-task-client/)
  assert.doesNotMatch(title, /<button|ServiceConfirmationButton|ServiceJourneys|week-task-title-actions/)
  const card = source.slice(start, source.indexOf('</React.Fragment>', start))
  assert.doesNotMatch(card, /<input|<textarea|<CustomerAutocomplete|<ServiceExtraFields|<ServicePhotoField|<ServicePhoto\b/)
})

test('service actions are above the weekly editor form and not duplicated in its footer', () => {
  const modal = source.slice(source.indexOf('className="modal weekly-task-modal"'))
  const form = modal.indexOf('<div className="weekly-task-form">')
  assert.ok(form > 0 && modal.slice(0, form).includes('weeklyModalActions(taskEditor)'))
  assert.doesNotMatch(source, /className="modal-actions"><ServiceConfirmationButton task=\{task\} day=\{day\}/)
  const toolbar = source.slice(source.indexOf('const weeklyModalActions'), source.indexOf('const openWeeklyTaskMove'))
  for (const action of ['ServiceConfirmationButton', 'ServiceJourneys', 'Reasignar</button>', 'Eliminar servicio']) assert.ok(toolbar.includes(action), action)
  assert.match(toolbar, /requestWeeklyLeave\(proceed\)/)
  assert.match(toolbar, /persistedTask.vehicleControl \? allowOmit : can\('planning.remove'\)/)
  assert.match(toolbar, /!taskIsResolvedForPlanning/)
  assert.match(toolbar, /String\(task.taskId\) === String\(taskId\)/)
})

test('read-only service modals retain their permitted actions', () => {
  assert.match(source, /actions=\{!readOnly && weeklyServiceSource && weeklyModalActions\(weeklyServiceSource, true\)\}/)
  assert.match(source, /<h2>\{pastService.client \|\| pastService.service\}<\/h2>\{!readOnly && weeklyServiceSource && weeklyModalActions/)
})
