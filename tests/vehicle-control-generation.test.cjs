const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { functionSource } = require('./helpers/frontend-source.cjs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const { visibleTechnicianStateForUser } = require('../api/_lib/core.cjs')

test('generating controls preserves past, started, closed and removed-fleet controls in history and weekly', async () => {
  const controls = await import('../src/domain/vehicles/vehicle-controls.mjs')
  const generation = await import('../src/features/agenda/application/vehicle-control-generation.mjs')
  const agenda = await import('../src/features/agenda/application/agenda-model.mjs')
  const configuration = await import('../src/domain/configuration/configuration-history.mjs')
  const today = '2026-10-20', month = '2026-10'
  const vehicles = ['past', 'started', 'closed', 'pending', 'task-started', 'new'].map(id => ({ id, brand: 'Renault', model: 'Kangoo', plate: id }))
  const technicians = [...vehicles.map(vehicle => vehicle.id), 'removed'].map(id => ({ id: 'tech-' + id, name: 'Técnico ' + id }))
  const teams = [{ teamId: 'team', label: 'Equipo 1', memberIds: technicians.map(t => t.id), members: technicians.map(t => t.name) }]
  const assignments = vehicles.map((vehicle, index) => ({ vehicleId: vehicle.id, technicianId: technicians[index].id }))
  const all = controls.buildVehicleControlRecords({ month, assignments, vehicles, technicians, teams })
  const history = all.filter(record => record.vehicleId !== 'new' && record.date === (record.vehicleId === 'past' ? '2026-10-16' : '2026-10-23')).map(record =>
    record.vehicleId === 'started' ? { ...record, startedAt: '2026-10-23T15:45:00Z' } :
      record.vehicleId === 'closed' ? { ...record, status: 'Completado', completedAt: '2026-10-23T16:00:00Z' } :
        { ...record, internalNote: 'Conservar anotación' })
  history.push({ ...history[0], id: 'vehicle-control-2026-10-30-removed', sourceTaskId: 'vehicle-control-2026-10-30-removed', vehicleId: 'removed', technicianIds: ['tech-removed'], technicians: ['Técnico removed'], date: '2026-10-30', vehicleControlScheduledFriday: '2026-10-30' })
  const weekly = { _monthlyTeams: { [month]: { teams, vehicleAssignments: assignments } } }
  for (const record of history) {
    weekly[record.date] ||= { teams: teams.map(team => ({ ...team, tasks: [] })) }
    weekly[record.date].teams[0].tasks.push({
      ...controls.vehicleControlTask(record),
      ...(record.vehicleId === 'task-started' ? { startedAt: '2026-10-23T15:46:00Z' } : {})
    })
  }
  const snapshot = { history, agenda: { date: today, teams: [], weekly } }
  const original = structuredClone(snapshot)
  let next, notice = ''
  const component = functionSource('OperationalPlanning')
  const handler = component.slice(component.indexOf('const saveMonthlyVehicleSetup'), component.indexOf('const annualGuardDraft'))
  const context = {
    ...controls, ...generation, ...configuration,
    monthlyTeams: weekly._monthlyTeams, monthlyVehicleSetup: { month, assignments: [] },
    weekly, vehicles, activeTechs: technicians, today, granular: true,
    holidayCalendar: { records: [] }, authUser: { id: 'operator', name: 'Operador configurado' },
    controlPause: require('../api/_lib/vehicle-controls-pause.cjs'),
    busyRef: { current: false }, pastMonthSelected: false, calendarReady: () => true,
    baselineRef: { current: { assignments, teams } }, assertUnchanged: assert.deepEqual,
    beginSave() {}, endSave() {}, reloadDrafts() {},
    reportError: assert.fail,
    canConfigureWeekly: () => false,
    requirePermission: key => key === 'weekly.controls.schedule',
    weeklyTaskRemovalAliases: agenda.weeklyTaskRemovalAliases,
    sortTasksByTime: agenda.sortTasksByTime,
    createDay: () => ({ teams: teams.map(team => ({ ...team, tasks: [] })) }),
    prettyDate: value => value,
    persistWeeklyConfiguration: async transform => {
      next = transform(snapshot)
      validateChangedAgendaSchedules(next, snapshot)
    },
    setNotice: value => { notice = value }
  }
  await vm.runInNewContext(`${handler}; saveMonthlyVehicleSetup(true)`, context)
  assert(next, notice)
  assert.match(notice, /Se generaron los controles/)
  for (const vehicleId of ['past', 'started', 'closed', 'task-started', 'removed']) {
    const record = history.find(item => item.vehicleId === vehicleId)
    assert.deepEqual(next.history.find(item => item.id === record.id), record, vehicleId)
    assert.deepEqual(next.agenda.weekly[record.date].teams[0].tasks.find(task => task.historyId === record.id),
      original.agenda.weekly[record.date].teams[0].tasks.find(task => task.historyId === record.id), vehicleId)
  }
  assert(history.every(record => next.history.some(item => item.id === record.id)), 'Generation never deletes a previous history row')
  assert(next.history.length > history.length, 'New future controls are generated')
  assert.equal(next.history.find(record => record.vehicleId === 'pending' && record.date === '2026-10-23').internalNote, 'Conservar anotación')
  assert.deepEqual(next.agenda.weekly._monthlyTeams, original.agenda.weekly._monthlyTeams, 'Schedule-only does not change monthly assignments')
  assert.deepEqual(snapshot, original, 'The confirmed source snapshot stays unchanged')

  const visible = visibleTechnicianStateForUser(next, { id: 'tech-new', roleCode: 'technician' })
  const { technicianAgendaServices } = await import('../src/domain/technicians/technician-history.mjs')
  const assigned = visible.history.filter(record => record.technicianIds?.includes('tech-new'))
  const work = technicianAgendaServices(assigned, '2026-10-23', next.agenda.weekly)
  assert.deepEqual(work.map(record => [record.id, record.time, record.estimatedMinutes]), [['vehicle-control-2026-10-23-new', '15:45', 15]])
})

test('regenerating a legacy control preserves its identity instead of adding a duplicate', async () => {
  const { prepareVehicleControlGeneration } = await import('../src/features/agenda/application/vehicle-control-generation.mjs')
  const previous = { id: 'legacy-id', sourceTaskId: 'legacy-task', vehicleControl: true, vehicleId: 'v', date: '2026-10-23', status: 'Pendiente', internalNote: 'Nota' }
  const generated = { ...previous, id: 'vehicle-control-2026-10-23-v', sourceTaskId: 'vehicle-control-2026-10-23-v', detail: 'Detalle actualizado' }
  const result = prepareVehicleControlGeneration({ history: [previous], agenda: { weekly: {} } }, [generated], '2026-10-20')
  assert.equal(result.history.length, 1)
  assert.equal(result.records[0].id, previous.id)
  assert.equal(result.records[0].sourceTaskId, previous.sourceTaskId)
  assert.equal(result.records[0].internalNote, 'Nota')
})
