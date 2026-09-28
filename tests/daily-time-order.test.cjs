const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')

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
