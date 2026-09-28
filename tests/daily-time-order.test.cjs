const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')

test('los refrescos y confirmaciones de guardado conservan el orden sin modificar la respuesta remota', async () => {
  const { preserveLocalDraft } = await import('../src/features/state/application/save-activity.mjs')
  const sorting = source.slice(source.indexOf('const taskTimeInMinutes ='), source.indexOf('const isSaturday ='))
  const at = source.indexOf('    const loaded_teams =', source.indexOf('const applyRemoteState ='))
  const hydration = source.slice(at, source.indexOf('    if (preserved.conflict)', at))
  const tasks = [{ taskId: 'a', time: '11:30' }, { taskId: 'b', time: '15:15', status: 'Completado' }, { taskId: 'c', time: '09:00' }]
  const data = { agenda: { date: '2026-09-28', teams: [{ teamId: 'one', tasks }], weekly: {} } }
  const context = {
    data, persistedAgendaDate: data.agenda.date, preserveFrom: null, preserveLocalDraft,
    loadedRoles: [], loaded_employees: [], loaded_services: [], loaded_vehicles: [], loaded_history: [], loaded_customers: [],
    currentSnapshotRef: { current: null }, hydrationBaselineRef: { current: null }, lastPersistedSnapshotRef: { current: null }
  }
  vm.createContext(context)
  for (let i = 0; i < 3; i++) {
    vm.runInContext(`{ ${sorting}\n${hydration}\n}`, context)
    const displayed = JSON.parse(context.currentSnapshotRef.current)
    assert.deepEqual(displayed.agenda.teams[0].tasks.map(task => task.time), ['09:00', '11:30', '15:15'])
    assert.equal(context.currentSnapshotRef.current, context.lastPersistedSnapshotRef.current)
  }
  const baseline = JSON.parse(context.currentSnapshotRef.current)
  const draft = structuredClone(baseline)
  draft.agenda.teams[0].tasks[0].time = '17:00'
  draft.agenda.teams[0].tasks[0].detail = 'Borrador pendiente'
  context.preserveFrom = baseline
  context.currentSnapshotRef.current = JSON.stringify(draft)
  vm.runInContext(`{ ${sorting}\n${hydration}\n}`, context)
  const merged = JSON.parse(context.currentSnapshotRef.current)
  assert.deepEqual(merged.agenda.teams[0].tasks.map(task => task.time), ['11:30', '15:15', '17:00'])
  assert.equal(merged.agenda.teams[0].tasks[2].detail, 'Borrador pendiente')
  assert.deepEqual(data.agenda.teams[0].tasks.map(task => task.time), ['11:30', '15:15', '09:00'])
})

test('cada edición del mismo campo horario vuelve a ordenar sin perder identidad ni datos', () => {
  const start = source.indexOf('  const updateTask = (team, task, patch) => {')
  const handler = source.slice(start, source.indexOf('\n  const isAdministrator', start))
  let teams = [{ tasks: [
    { taskId: 'a', time: '11:30', detail: 'A' },
    { taskId: 'b', time: '15:15', status: 'Completado' },
    { taskId: 'c', time: '16:00', detail: 'C' }
  ] }]
  let blur
  const input = { dataset: {}, matches: () => true, addEventListener: (event, callback) => { assert.equal(event, 'blur'); blur = callback } }
  const context = {
    document: { activeElement: input }, authUser: {},
    stampServiceRecord: record => record, removeUnavailableDefaultSlots: tasks => tasks,
    sortTasksByTime: tasks => [...tasks].sort((a,b) => a.time.localeCompare(b.time)),
    setTeams: update => { teams = update(teams) }
  }
  vm.createContext(context)
  vm.runInContext(handler + '\nglobalThis.updateTask = updateTask', context)
  const edit = time => {
    context.updateTask(0, teams[0].tasks.findIndex(task => task.taskId === 'c'), { time })
    assert.equal(typeof blur, 'function')
    const callback = blur; blur = null; callback()
  }
  edit('09:00')
  assert.deepEqual(teams[0].tasks.map(task => task.taskId), ['c','a','b'])
  edit('17:00')
  assert.deepEqual(teams[0].tasks.map(task => task.taskId), ['a','b','c'])
  edit('10:00')
  assert.deepEqual(teams[0].tasks.map(task => task.taskId), ['c','a','b'])
  assert.equal(teams[0].tasks[0].detail, 'C')
  assert.equal(teams[0].tasks[2].status, 'Completado')
})

test('la agenda técnica ordena fecha y hora aunque reciba registros desordenados', async () => {
  const { technicianAgendaServices } = await import('../src/domain/technicians/technician-history.mjs')
  const records = [
    { id:'late', date:'2026-09-28', time:'15:15' },
    { id:'tomorrow', date:'2026-09-29', time:'08:00' },
    { id:'middle', date:'2026-09-28', time:'11:30' },
    { id:'early', date:'2026-09-28', time:'09:00' },
    { id:'unknown', date:'2026-09-28' }
  ]
  assert.deepEqual(technicianAgendaServices(records, '2026-09-28').map(record => record.id), ['early','middle','late','unknown','tomorrow'])
  assert.equal(records[0].id, 'late')
})
