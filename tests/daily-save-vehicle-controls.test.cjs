const { functionSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { isGranular } = require('../api/_lib/permission-catalog.cjs')
const source = functionSource('AgendaWorkspaceForm')
const start = source.indexOf('  const registerHistory =')
const code = source.slice(start, source.indexOf('  const dailyServiceHasChanges', start))
let dependencies
test.before(async () => {
  const { historyRecordForTask, taskHasContent, serviceTrace } = await import('../src/features/agenda/application/agenda-model.mjs')
  const { ticketLinkFields, ticketReferenceDetail } = await import('../src/features/agenda/application/ticket-service-draft.mjs')
  dependencies = { historyRecordForTask, taskHasContent, serviceTrace, ticketLinkFields, ticketReferenceDetail }
})

async function recordsFor(teams, onlyTaskId = null, { authUser = null, changed = [], history = [], canSaveTask = () => true } = {}) {
  const written = []
  const persist = records => {
    written.push(...records)
    return { state: { history: records } }
  }
  let error
  const save = vm.runInNewContext(code + '\nregisterHistory', {
    ...dependencies, teams, history, authUser, isGranular, canSaveTask, controlPause: require('../api/_lib/vehicle-controls-pause.cjs'),
    dailyServiceHasChanges: task => changed.includes(task),
    setDailySaveError: value => { error = value },
    agendaTeamsWithRealServices: values => values, validateAgenda: () => true,
    pastDayBlocked: false, sundayBlocked: false, holidayBlocked: false, holidayCalendarUnavailable: false, weekly: {},
    persistAgendaRecords: (_previous, records) => persist(records), persistWeeklyService: ({ record }) => persist([record]),
    dailyCompleted: task => task.status === 'Completado', date: '2026-09-18',
    serviceEstimateForTask: () => 90, serviceForTask: task => ({ id: task.serviceId, name: task.service }),
    normalizeInternalChecklist: value => value || [], applicableServiceExtras: () => ({})
  })
  assert.equal(await save(teams, onlyTaskId), true, error?.message)
  return written
}

test('daily save does not rebuild automatic controls with all team members', async () => {
  const control = { taskId: 'control-1', historyId: 'control-1', vehicleControl: true, vehicleId: 'v1', technicianIds: ['t1'], client: 'Vehículo', serviceId: 'vehicle-control' }
  const service = { taskId: 'job-1', historyId: 'job-1', time: '08:45', client: 'Cliente', serviceId: 's1', service: 'Instalación' }
  const teams = [{ teamId: 'team-1', memberIds: ['t1', 't2'], members: ['Uno', 'Dos'], tasks: [control, service] }]
  const before = JSON.stringify(teams)
  const history = [{ id: service.historyId, date: '2026-09-18', sourceTicketId: 'ticket-8', ticketNumber: '100008' }]
  const records = await recordsFor(teams, null, { history })
  assert.equal(records.length, 1)
  assert.equal(records[0].id, 'job-1')
  assert.equal(records[0].sourceTicketId, 'ticket-8')
  assert.equal(records[0].ticketNumber, '100008')
  assert.match(records[0].detail, /Ticket#100008/)
  assert.deepEqual(Array.from(records[0].technicianIds), ['t1', 't2'])
  assert.equal(JSON.stringify(teams), before)
  assert.equal((await recordsFor(teams, 'job-1')).length, 1)
})

test('a day with only automatic controls needs no manual history write', async () => {
  const tasks = [{ vehicleControl: true, service: 'Control semanal de vehículo' }, { serviceId: 'vehicle-weekly-control', service: 'Control antiguo' }]
  assert.deepEqual(await recordsFor([{ tasks }]), [])
})

test('granular daily save includes only changed selected services and still excludes controls and completed work', async () => {
  const base = { time: '09:00', client: 'Cliente', serviceId: 's1', service: 'Instalación' }
  const changedService = { ...base, taskId: 'changed', historyId: 'changed' }
  const unchangedService = { ...base, taskId: 'unchanged', historyId: 'unchanged' }
  const completedService = { ...base, taskId: 'completed', status: 'Completado' }
  const control = { ...base, taskId: 'control', vehicleControl: true, technicianIds: ['t1'] }
  const teams = [{ teamId: 'team-1', memberIds: ['t1', 't2'], members: ['Uno', 'Dos'], tasks: [changedService, unchangedService, completedService, control] }]
  const before = JSON.stringify(teams)
  const { canWriteRecord } = await import('../src/domain/access/record-scope.mjs')
  const authUser = { id: 't2', permissions: { __catalogV2: true, 'scope.services.write.assigned': true } }
  const options = { authUser, changed: [changedService, completedService, control], canSaveTask: task => canWriteRecord({ technicianIds: teams[0].memberIds, ...task }, authUser) }
  assert.deepEqual((await recordsFor(teams, null, options)).map(record => record.id), ['changed'])
  assert.equal((await recordsFor(teams, 'changed', options)).length, 1)
  assert.equal((await recordsFor(teams, 'unchanged', options)).length, 0)
  assert.equal((await recordsFor(teams, null, { ...options, changed: [] })).length, 0)
  assert.deepEqual((await recordsFor(teams)).map(record => record.id), ['changed', 'unchanged'], 'el guardado legacy conserva su selección anterior')
  assert.equal(JSON.stringify(teams), before, 'el filtro no modifica servicios ni asignaciones')
})
