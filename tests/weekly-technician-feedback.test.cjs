const { frontendSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const source = frontendSource()
let interactions
test.before(async () => { interactions = await import('../src/presentation/pending-interaction.mjs') })
function harness(saturday = false) {
  const day = '2026-09-28'
  const team = { teamId: 'team-2', memberIds: ['a'], members: ['A'], tasks: [] }
  const otherTeam = { teamId: 'team-3', memberIds: ['b'], members: ['B'], tasks: [] }
  let selections = {}
  const requests = [], notices = [], timers = [], deferred = []
  const context = {
    ...interactions,
    requirePermission: () => true,
    afterInteractionPaint: () => new Promise(resolve => timers.push(resolve)),
    memberSelectionsRef: { current: selections },
    setMemberSelections: update => { selections = update(selections); context.memberSelectionsRef.current = selections },
    advancedGuardForDay: () => null, isSaturday: () => saturday,
    activeTechs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    dayPlan: () => ({ teams: [team, otherTeam] }), weekly: { [day]: { teams: [team, otherTeam] } },
    setNotice: value => notices.push(value),
    persistWeeklyService: command => { requests.push(command); return new Promise((resolve, reject) => deferred.push({ resolve, reject })) },
  }
  const code = source.slice(source.indexOf('  const persistMemberSelection ='), source.indexOf('  const updateTask =', source.indexOf('  const toggleWeeklyTech =')))
  const handlers = vm.runInNewContext(code + '\n({toggleWeeklyTech, persistMemberSelection})', context)
  context.persistMemberSelection = handlers.persistMemberSelection
  const effectStart = source.indexOf('    for (const [key, preview] of Object.entries(memberSelections))')
  const effect = source.slice(effectStart, source.indexOf('  }, [memberSelections, weekly, confirmedRevision])', effectStart))
  return {
    day, team, otherTeam, toggle: handlers.toggleWeeklyTech, context, requests, notices, timers,
    selection: (index = 0) => selections[interactions.weeklyTeamInteractionKey(day, index ? otherTeam.teamId : team.teamId, index)],
    resolve: (index = 0) => deferred[index].resolve({ revision: 2 }),
    reject: (index = 0) => deferred[index].reject(new Error('Sin conexión')),
    confirm: (index = 0, authoritativeMembership) => {
      const command = requests[index]
      Object.assign(command.teamId === team.teamId ? team : otherTeam, authoritativeMembership || { memberIds: command.memberIds, members: command.members })
      context.memberSelections = selections
      context.confirmedRevision = 2
      vm.runInNewContext(effect, context)
    }
  }
}

test('checkbox responds before network work and rapid changes coalesce behind one request', async () => {
  const h = harness()
  const save = h.toggle(h.day, 0, 'B')
  assert.equal(JSON.stringify(h.selection().memberIds), '["a","b"]')
  assert.equal(h.requests.length, 0)
  await h.toggle(h.day, 0, 'B')
  assert.equal(JSON.stringify(h.selection().memberIds), '["a"]')
  assert.equal(h.timers.length, 1)
  h.timers[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.team.memberIds, ['a']) // no mutation of persisted/global state
  h.resolve()
  await save
  assert.equal(h.selection().phase, 'acknowledged')
  assert.equal(Object.keys(h.context.memberSelectionsRef.current).length, 1)
  assert.equal(interactions.interactionIsConfirmed(h.selection(), 1, false), false)
  assert.equal(interactions.interactionIsConfirmed(h.selection(), 2, true), true)
  h.confirm()
  assert.equal(h.selection().phase, 'pending')
  assert.equal(h.timers.length, 2)
  h.timers[1]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.requests.length, 2)
  assert.equal(JSON.stringify(h.requests[1].baseMemberIds), '["a","b"]')
  assert.equal(JSON.stringify(h.requests[1].memberIds), '["a"]')
  h.resolve(1)
  await new Promise(resolve => setImmediate(resolve))
  h.confirm(1)
  assert.equal(h.selection(), undefined)
})

test('failed uncheck restores original selection and allows retry', async () => {
  const h = harness()
  const save = h.toggle(h.day, 0, 'A')
  assert.equal(h.selection().memberIds.length, 0)
  h.timers[0]()
  await new Promise(resolve => setImmediate(resolve))
  h.reject()
  await save
  assert.equal(h.selection(), undefined)
  assert.deepEqual(h.team.memberIds, ['a'])
  assert.match(h.notices.at(-1), /No se guardó.*Sin conexión/)
  assert.equal(Object.keys(h.context.memberSelectionsRef.current).length, 0)
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

test('picker exposes pending state while allowing its selection to keep changing', () => {
  assert.match(source, /aria-busy=\{Boolean\(memberSelection\)\}/)
  assert.doesNotMatch(source, /type="checkbox" disabled=\{Boolean\(memberSelection\)\}/)
  assert.match(source, /const memberSelection = memberSelections\[weeklyTeamInteractionKey/)
  assert.match(source, /role="status" aria-live="polite">.*Guardando selección/)
})

test('independent teams update immediately and one failure does not clear another acknowledgement', async () => {
  const h = harness()
  const first = h.toggle(h.day, 0, 'B')
  const second = h.toggle(h.day, 1, 'B')
  assert.equal(JSON.stringify(h.selection().memberIds), '["a","b"]')
  assert.equal(JSON.stringify(h.selection(1).memberIds), '[]')
  assert.equal(Object.keys(h.context.memberSelectionsRef.current).length, 2)
  h.timers.forEach(resolve => resolve())
  await new Promise(resolve => setImmediate(resolve))
  h.resolve(1)
  await second
  assert.equal(h.selection(1).phase, 'acknowledged')
  h.reject(0)
  await first
  assert.equal(h.selection(), undefined)
  assert.equal(h.selection(1).phase, 'acknowledged')
  assert.deepEqual(h.team.memberIds, ['a'])
  assert.deepEqual(h.otherTeam.memberIds, ['b'])
})

test('acknowledged previews wait for their revision and accept a newer authoritative edit', () => {
  const preview = interactions.acknowledgedInteraction({ ready: true }, { state: { revision: 8 } })
  assert.equal(interactions.interactionIsConfirmed(preview, 7, true), false)
  assert.equal(interactions.interactionIsConfirmed(preview, 8, false), true)
  assert.equal(interactions.interactionIsConfirmed({ ...preview, phase: 'pending' }, 8, true), false)
  const withoutRevision = interactions.acknowledgedInteraction({ ready: true })
  assert.equal(interactions.interactionIsConfirmed(withoutRevision, undefined, false), false)
  assert.equal(interactions.interactionIsConfirmed(withoutRevision, undefined, true), true)
})

test('returning to the sent selection during flight does not send a redundant command', async () => {
  const h = harness()
  const first = h.toggle(h.day, 0, 'B')
  await h.toggle(h.day, 0, 'B')
  await h.toggle(h.day, 0, 'B')
  h.timers[0]()
  await new Promise(resolve => setImmediate(resolve))
  h.resolve()
  await first
  h.confirm()
  assert.equal(h.selection(), undefined)
  assert.equal(h.requests.length, 1)
  assert.equal(h.timers.length, 1)
})

test('a newer authoritative membership cancels queued intent without overwriting another edit', async () => {
  const h = harness()
  const first = h.toggle(h.day, 0, 'B')
  await h.toggle(h.day, 0, 'A')
  h.timers[0]()
  await new Promise(resolve => setImmediate(resolve))
  h.resolve()
  await first
  h.confirm(0, { memberIds: ['c'], members: ['C'] })
  assert.equal(h.selection(), undefined)
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.team.memberIds, ['c'])
  assert.match(h.notices.at(-1), /equipo cambió.*asignación confirmada/)
})

test('revoking assignment permission prevents another optimistic change or request', async () => {
  const h = harness()
  h.context.requirePermission = () => false
  await h.toggle(h.day, 0, 'B')
  assert.equal(h.selection(), undefined)
  assert.equal(h.requests.length, 0)
})
