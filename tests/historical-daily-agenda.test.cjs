const { frontendSource, functionSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default
const source = frontendSource()
const code = source.slice(source.indexOf('function historicalAgendaTeams('), source.indexOf('function HistoricalDailyAgenda('))
const recover = vm.runInNewContext(code + '\nhistoricalAgendaTeams', {
  applyRemovedWeeklyTeams: teams => teams,
  applyRemovedWeeklySlots: teams => teams,
  applyRemovedWeeklyTasks: (teams, removed) => teams.map(team => ({ ...team, tasks: team.tasks.filter(task => !removed.includes(task.taskId)) })),
  historyRecordForTask: (task, date, history) => history.find(record => record.date === date && record.id === task.historyId),
  sortTasksByTime: tasks => [...tasks].sort((a, b) => a.time.localeCompare(b.time))
})
test('recupera todos los estados y pagos sin mutar la agenda ni duplicar servicios', () => {
  const date = '2026-09-17'
  const weekly = { [date]: { teams: [{ teamId: 'a', label: 'Equipo 1', tasks: [{ taskId: 't', historyId: 'h', time: '08:00', amount: '1' }] }] } }
  const history = [{ id: 'h', date, teamId: 'a', time: '08:00', status: 'Completado', amount: '260000' }, { id: 'c', date, teamId: 'a', time: '10:00', status: 'Cancelado' }]
  const before = JSON.stringify({ weekly, history })
  const teams = recover(date, weekly, history)
  assert.equal(teams.length, 1)
  assert.equal(teams[0].tasks.length, 2)
  assert.equal(teams[0].tasks[0].amount, '260000')
  assert.equal(teams[0].tasks[1].status, 'Cancelado')
  assert.equal(JSON.stringify({ weekly, history }), before)
})
test('fecha vacía no genera equipos ni servicios predeterminados', () => {
  assert.equal(recover('2026-09-01', {}, []).length, 0)
})

test('una jornada retirada no reaparece desde el historial al consultar su día vencido', () => {
  const date = '2026-09-25'
  const history = [{ id: 'journey-2', sourceTaskId: 'task-2', date, teamId: 'a', time: '09:00', status: 'Cancelado', serviceJourney: { id: 'journey-1', index: 2, total: 2 } }]
  for (const marker of ['history:journey-2', 'task:task-2', 'task-2']) {
    const weekly = { [date]: { teams: [{ teamId: 'a', tasks: [] }], removedTaskIds: [marker] } }
    assert.equal(recover(date, weekly, history)[0].tasks.length, 0)
  }
})

test('la reparación de una reprogramación respeta la baja posterior de su jornada', () => {
  const moveCode = source.slice(source.indexOf('const moveRecordInWeeklyAgenda ='), source.indexOf('const moveRecordInWeeklyAgenda =') + source.slice(source.indexOf('const moveRecordInWeeklyAgenda =')).indexOf('\n}\n') + 2)
  const repair = vm.runInNewContext(moveCode + '\nmoveRecordInWeeklyAgenda')
  const record = { id: 'journey-2', sourceTaskId: 'task-2', date: '2026-09-25', rescheduledFrom: '2026-09-24', status: 'Cancelado' }
  for (const marker of ['history:journey-2', 'task:task-2', 'task-2']) {
    const weekly = { [record.date]: { teams: [], removedTaskIds: [marker] } }
    assert.equal(repair(weekly, record, record.date), weekly)
  }
})
test('la consulta está separada del editor y no expone acciones de escritura', () => {
  const view = source.slice(source.indexOf('function HistoricalDailyAgenda('), source.indexOf('function AgendaWorkspace('))
  assert.doesNotMatch(view, /setTeams|setWeekly|Guardar|Eliminar|onCommit|persistWeeklyService/)
  assert.match(view, /HistoricalServiceFields/)
  assert.match(source, /if \(nextDate < currentLocalDate\(\)\) setHistoricalDate\(nextDate\)/)
})

test('el banner abre una vista previa de cualquier día sin cambiar la agenda ni abrir el editor', () => {
  const planner = functionSource('WeeklyPlanner')
  let trigger
  traverse(parse(planner, { sourceType: 'module', plugins: ['jsx'] }), {
    JSXOpeningElement({ node }) {
      if (node.name.name === 'button' && node.attributes.some(attribute => attribute.name?.name === 'className' && attribute.value?.value === 'weekly-day-preview-trigger')) trigger = node
    }
  })
  assert.ok(trigger)
  assert.equal(trigger.attributes.some(attribute => attribute.name?.name === 'disabled'), false, 'Historical dates must still have a usable preview')
  const callback = trigger.attributes.find(attribute => attribute.name?.name === 'onClick').value.expression
  for (const day of ['2026-09-17', '2026-10-13']) {
    const plan = { teams: [{ teamId: 'a', tasks: [{ taskId: 't', detail: 'borrador' }] }] }
    const before = JSON.stringify(plan)
    let preview
    const onClick = vm.runInNewContext(planner.slice(callback.start, callback.end), {
      day, services: [], operationalHistory: [], dayPlan: () => plan,
      historyRecordForTask: () => ({ detail: 'guardado', status: 'Completado' }),
      setDayPreview: value => { preview = value },
      dayAgendaPreview: (date, teams) => {
        assert.equal(date, day)
        assert.equal(teams[0].tasks[0].detail, 'guardado')
        assert.equal(teams[0].tasks[0].status, 'Completado')
        return 'Vista previa de prueba'
      },
      openDaily: () => { throw new Error('Preview must not navigate to the editing module') }
    })
    onClick()
    assert.equal(preview.day, day)
    assert.equal(preview.text, 'Vista previa de prueba')
    assert.equal(JSON.stringify(plan), before)
  }
})
