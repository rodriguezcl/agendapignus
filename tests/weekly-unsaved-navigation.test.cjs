const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const start = source.indexOf('  const requestWeeklyLeave =')
const body = source.slice(start, source.indexOf('  useEffect(', start))
function harness(overrides = {}) {
  const requests = [], opened = []
  const context = { taskEditorSaveGuardRef: { current: false }, taskEditor: null, weekly: {}, authUser: { id: 'me' }, operationalHistory: [], taskHasContent: task => Boolean(task.client), taskWithServiceEstimate: task => task, serviceForWeeklyTask: () => null, historyRecordForTask: task => task.saved, dayHasFinished: () => false, dayPlan: day => context.weekly[day], setLeaveRequest: request => requests.push(request), openTaskEditor: (...args) => opened.push(args), ...overrides }
  return { requests, opened, run: vm.runInNewContext(body + '\nrequestWeeklyLeave', context) }
}
test('clean navigation continues and empty cards do not block', () => {
  const h = harness({ weekly: { '2026-09-17': { teams: [{ tasks: [{ client: '', createdBy: { id: 'me' } }] }] } } })
  let continued = false
  h.run(() => { continued = true })
  assert.equal(continued, true)
  assert.equal(h.requests.length, 0)
})
test('own unsaved service is opened and the requested action is deferred', () => {
  const h = harness({ weekly: { '2026-09-17': { teams: [{ tasks: [{ client: 'Capacitación', createdBy: { id: 'me' } }] }] } } })
  let continued = false
  h.run(() => { continued = true })
  assert.equal(continued, false)
  assert.equal(h.opened.length, 1)
  h.requests[0].action()
  assert.equal(continued, true)
})
test('other users drafts do not block navigation', () => {
  const h = harness({ weekly: { '2026-09-17': { teams: [{ tasks: [{ client: 'Otro', createdBy: { id: 'someone-else' } }] }] } } })
  let continued = false
  h.run(() => { continued = true })
  assert.equal(continued, true)
})
test('local editor changes prevent navigation and unsuccessful saves never resume it', () => {
  const h = harness({ taskEditor: { draft: { client: 'Nuevo' }, baseTask: { client: 'Anterior' }, baseRecord: { id: 'saved' } } })
  let continued = false
  h.run(() => { continued = true })
  assert.equal(continued, false)
  assert.equal(h.requests.length, 1)
  assert.match(source, /if \(await saveTaskEditor\(\)\) setResumeNavigation\(request\)/)
})
