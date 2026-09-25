const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
function harness(saturday = false) {
  const day = '2026-09-28'
  const team = { teamId: 'team-2', memberIds: ['a'], members: ['A'], tasks: [] }
  let selection, resolveSave, rejectSave
  const requests = [], notices = [], timers = []
  const context = {
    memberSelectionGuard: { current: false },
    setMemberSelection: value => { selection = value },
    advancedGuardForDay: () => null, isSaturday: () => saturday,
    activeTechs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    dayPlan: () => ({ teams: [team] }), weekly: { [day]: { teams: [team] } },
    setNotice: value => notices.push(value),
    window: { setTimeout: callback => timers.push(callback) },
    persistWeeklyService: command => { requests.push(command); return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject }) },
  }
  const code = source.slice(source.indexOf('  const toggleWeeklyTech ='), source.indexOf('  const updateTask =', source.indexOf('  const toggleWeeklyTech =')))
  const toggle = vm.runInNewContext(code + '\ntoggleWeeklyTech', context)
  return { day, team, toggle, context, requests, notices, timers, selection: () => selection, resolve: () => resolveSave(), reject: () => rejectSave(new Error('Sin conexión')) }
}

test('checkbox responds before network work and repeated clicks cannot submit duplicates', async () => {
  const h = harness()
  const save = h.toggle(h.day, 0, 'B')
  assert.equal(JSON.stringify(h.selection().memberIds), '["a","b"]')
  assert.equal(h.requests.length, 0)
  await h.toggle(h.day, 0, 'B')
  assert.equal(h.timers.length, 1)
  h.timers[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.team.memberIds, ['a']) // no mutation of persisted/global state
  h.resolve()
  await save
  assert.equal(h.selection(), null)
  assert.equal(h.context.memberSelectionGuard.current, false)
})

test('failed uncheck restores original selection and allows retry', async () => {
  const h = harness()
  const save = h.toggle(h.day, 0, 'A')
  assert.equal(h.selection().memberIds.length, 0)
  h.timers[0]()
  await new Promise(resolve => setImmediate(resolve))
  h.reject()
  await save
  assert.equal(h.selection(), null)
  assert.deepEqual(h.team.memberIds, ['a'])
  assert.match(h.notices.at(-1), /No se guardó.*Sin conexión/)
  assert.equal(h.context.memberSelectionGuard.current, false)
})

test('Saturday selection retains exactly one technician', async () => {
  const h = harness(true)
  await h.toggle(h.day, 0, 'A')
  assert.equal(h.selection(), undefined)
  const save = h.toggle(h.day, 0, 'B')
  assert.equal(JSON.stringify(h.selection().memberIds), '["b"]')
  h.timers[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.requests[0].guardOverride, true)
  h.resolve()
  await save
})

test('picker exposes pending state and disables repeated changes while saving', () => {
  assert.match(source, /aria-busy=\{Boolean\(memberSelection\)\}/)
  assert.match(source, /type="checkbox" disabled=\{Boolean\(memberSelection\)\}/)
  assert.match(source, /role="status" aria-live="polite">Guardando selección/)
})
