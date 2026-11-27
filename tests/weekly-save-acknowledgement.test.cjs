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
  await save()
  assert.match(errors.at(-1), /Falta la confirmación/)
  assert.equal(context.taskEditor.pendingCreation, sent[0])
  // A later shift or a background refresh must not reconstruct the first create.
  context.dayHasFinished = () => true
  assert.equal(await save(), true)
  assert.equal(sent[1], sent[0])
  assert.equal(generated, 1)
  assert.equal(context.taskEditor.pendingCreation, null)
})
