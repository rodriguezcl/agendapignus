const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
function harness(attachmentFailure = false) {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/agenda/presentation/WeeklyPlanner.jsx'), 'utf8')
  const code = source.slice(source.indexOf('  const saveTaskEditor ='), source.indexOf('  const requestWeeklyLeave ='))
  const team = { teamId: 'team', members: ['Técnico'], tasks: [] }, day = '2026-11-06'
  const record = { id: 'work-task', sourceTaskId: 'task', status: 'Pendiente', normalizedByServer: true }
  const task = { taskId: 'task', historyId: record.id, normalizedByServer: true }
  const calls = [], errors = []
  const context = {
    taskEditor: { day, teamIndex: 0, taskIndex: 0, teamId: team.teamId, teamSnapshot: team, taskId: 'task', draft: { taskId: 'task', time: '10:00' }, baseRecord: null, baseTask: null, photoData: attachmentFailure ? ['file'] : null },
    taskEditorSaveGuardRef: { current: false }, setTaskEditorSaving() {}, setTaskEditorError: error => errors.push(error),
    setTaskEditor: update => { context.taskEditor = typeof update === 'function' ? update(context.taskEditor) : update },
    canSaveTask: () => true, canEditTask: () => true, can: () => true, taskStatus: () => 'Pendiente',
    dayHasFinished: () => false, ticketLinkFields: () => ({}), advancedGuardForDay: () => null,
    weeklyTaskMissingFields: () => [], requiresPaymentAmount: () => false, serviceForWeeklyTask: () => ({}),
    serviceTimeInMinutes: () => 600, currentLocalDate: () => '2026-11-05', hoursForDay: () => null,
    taskOccupiedInterval: () => null, taskWithServiceEstimate: task => task, dayPlan: () => ({ teams: [team] }),
    minimumServiceGapConflicts: () => [], taskForScheduleOccupancy: task => task, operationalHistory: [],
    stampServiceRecord: record => record, applicableServiceExtras: () => ({}), authUser: {},
    weeklyHistoryRecord: () => ({ id: record.id }), serviceCode: () => 'alarm-installation', setNotice() {},
    persistWeeklyService: async command => { calls.push(command); return { state: { history: [record], agenda: { weekly: { [day]: { teams: [{ ...team, tasks: [task] }] } } } } } },
    uploadAttachmentBatch: async () => { throw new Error('Error de adjunto simulado') }
  }
  return { context, calls, errors, record, task, save: vm.runInNewContext(code + '\nsaveTaskEditor', context) }
}
test('instalación mantiene la versión normalizada confirmada para el siguiente guardado', async () => {
  const h = harness()
  assert.equal(await h.save(), true)
  assert.equal(h.context.taskEditor.baseRecord, h.record)
  assert.equal(h.context.taskEditor.baseTask, h.task)
  assert.equal(h.context.taskEditor.draft, h.task)
  assert.equal(await h.save(), true)
  assert.equal(h.calls[1].baseRecord, h.record)
  assert.equal(h.calls[1].baseTask, h.task)
})

test('el alta con adjuntos se mide hasta el pintado de la confirmación y sólo una vez', async () => {
  const { beginWeeklyServiceSaveTiming } = await import('../src/features/agenda/application/weekly-service-save-timing.mjs')
  const h = harness(true)
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const samples = [], frame = Promise.withResolvers(), upload = Promise.withResolvers()
  let now = 110, frameRequests = 0
  h.context.saveTimingRef = { current: null }
  h.context.beginWeeklyServiceSaveTiming = (stamp, attached) => beginWeeklyServiceSaveTiming(stamp, attached, {
    doc, clock: () => now, send: sample => samples.push(sample),
    afterPaint: () => { frameRequests++; return frame.promise }
  })
  h.context.uploadAttachmentBatch = () => upload.promise
  const saved = h.save({ type: 'click', timeStamp: 100 })
  await new Promise(setImmediate)
  h.context.saveTimingRef.current.afterCommit()
  assert.equal(frameRequests, 0)
  now = 350
  upload.resolve()
  assert.equal(await saved, true)
  assert.equal(frameRequests, 0)
  h.context.saveTimingRef.current.afterCommit()
  h.context.saveTimingRef.current.afterCommit()
  assert.equal(frameRequests, 1)
  assert.deepEqual(samples, [])
  now = 410
  frame.resolve()
  await new Promise(setImmediate)
  assert.deepEqual(samples, [{ durationMs: 310, retried: false, withAttachments: true }])
  // This installation editor stays open. A later save changes the record.
  h.context.beginWeeklyServiceSaveTiming = () => assert.fail('Se midió una edición')
  assert.equal(await h.save({ type: 'click', timeStamp: 400 }), true)
})

test('una pestaña que se oculta durante el guardado o antes de pintar descarta la muestra', async () => {
  const { beginWeeklyServiceSaveTiming } = await import('../src/features/agenda/application/weekly-service-save-timing.mjs')
  for (const beforeCommit of [true, false]) {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const samples = [], frame = Promise.withResolvers()
    const timing = beginWeeklyServiceSaveTiming(10, false, { doc, clock: () => 80, afterPaint: () => frame.promise, send: sample => samples.push(sample) })
    const hideAndReturn = () => {
      doc.visibilityState = 'hidden'
      doc.dispatchEvent(new Event('visibilitychange'))
      doc.visibilityState = 'visible'
    }
    if (beforeCommit) hideAndReturn()
    timing.confirm(true)
    timing.afterCommit()
    if (!beforeCommit) hideAndReturn()
    frame.resolve()
    await new Promise(setImmediate)
    assert.deepEqual(samples, [])
  }
})
test('fallo de adjuntos conserva confirmación e identidad: reintentar actualiza y no crea otro servicio', async () => {
  const h = harness(true)
  await h.save()
  assert.equal(h.context.taskEditor.baseRecord, h.record)
  assert.equal(h.context.taskEditor.baseTask, h.task)
  assert.match(h.errors.at(-1), /El servicio quedó guardado, pero faltan adjuntos/)
  await h.save()
  assert.equal(h.calls[1].baseRecord, h.record)
  assert.equal(h.calls[0].record.id, h.calls[1].record.id)
})

test('el reintento manual de un alta incierta conserva el mismo cliente rápido, fecha y servicio', async () => {
  const { context, errors, save } = harness()
  let generated = 0
  const measurements = []
  context.saveTimingRef = { current: null }
  context.beginWeeklyServiceSaveTiming = start => {
    const outcome = { start }
    measurements.push(outcome)
    return { cancel() { outcome.cancelled = true }, confirm(retried) { outcome.retried = retried } }
  }
  context.taskEditor.draft.newCustomer = true
  context.requirePermission = () => true
  context.customers = []
  context.createQuickClient = draft => {
    const customer = { customerId: 'cli-' + (++generated) }
    return { customer, task: { ...draft, newCustomer: false, customerId: customer.customerId } }
  }
  const acknowledge = context.persistWeeklyService
  const sent = []
  context.persistWeeklyService = async command => {
    sent.push(command)
    if (sent.length === 1) throw Object.assign(new Error(), { code: 'STATE_WRITE_UNCONFIRMED' })
    return acknowledge(command)
  }
  await save({ type: 'click', timeStamp: 10 })
  assert.match(errors.at(-1), /Falta la confirmación/)
  assert.equal(context.taskEditor.pendingCreation, sent[0])
  // A later shift or a background refresh must not reconstruct the first create.
  context.dayHasFinished = () => true
  assert.equal(await save({ type: 'click', timeStamp: 70000 }), true)
  assert.equal(sent[1], sent[0])
  assert.equal(generated, 1)
  assert.equal(context.taskEditor.pendingCreation, null)
  assert.deepEqual(measurements, [{ start: 10, cancelled: true }, { start: 70000, retried: true }])
})
