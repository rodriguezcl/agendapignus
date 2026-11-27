const test = require('node:test')
const assert = require('node:assert/strict')
const { resumeVehicleControls } = require('../api/_lib/vehicle-controls-resume.cjs')
const { cutoff } = require('../api/_lib/technician-agenda-gate.cjs')

function control(friday, vehicleId, changes = {}) {
  const id = `vehicle-control-${friday}-${vehicleId}`
  return {
    id, sourceTaskId: id, teamId: 'equipo', technicianIds: ['tecnico'],
    vehicleId, vehicleControl: true, vehicleControlScheduledFriday: friday,
    serviceId: 'vehicle-weekly-control', date: friday, time: '15:45',
    estimatedMinutes: 15, vehicleMileageAtScheduling: 10000, status: 'Pendiente',
    detail: 'Verificar luces y neumáticos.', ...changes,
  }
}

async function pausedState(records, dailyDate) {
  const { vehicleControlTask } = await import('../src/domain/vehicles/vehicle-controls.mjs')
  const weekly = { _vehicleControls: { paused: true } } // Pausa guardada antes de conocer la fecha de reanudación.
  for (const record of records) {
    weekly[record.date] ??= { teams: [{ teamId: 'equipo', memberIds: ['tecnico'], tasks: [] }] }
    const task = record.serviceId === 'vehicle-weekly-control'
      ? vehicleControlTask(record)
      : { taskId: record.sourceTaskId, historyId: record.id, serviceId: record.serviceId, time: record.time }
    weekly[record.date].teams[0].tasks.push(task)
  }
  return { history: records, agenda: { date: dailyDate, ...structuredClone(weekly[dailyDate]), weekly } }
}

function resume(previous, today) {
  const next = structuredClone(previous)
  next.agenda.weekly._vehicleControls = { paused: false }
  return resumeVehicleControls(next, previous, today)
}

test('reanudar una pausa existente cancela los controles vencidos y libera ambas agendas sin bloquear al técnico', async () => {
  const missed = control('2026-12-04', 'ford')
  const moved = control('2026-12-11', 'renault', { date: '2026-12-15' })
  const upcoming = control('2026-12-18', 'ford')
  const ordinary = { id: 'alarma', sourceTaskId: 'alarma', date: moved.date, time: '09:00', serviceId: 'alarma', status: 'Pendiente' }
  const previous = await pausedState([missed, moved, upcoming, ordinary], moved.date)
  const today = '2026-12-14'
  const resumed = resume(previous, today)
  const byId = new Map(resumed.history.map(record => [record.id, record]))
  assert.equal(byId.size, 4)
  for (const record of [missed, moved]) {
    assert.equal(byId.get(record.id).status, 'Cancelado')
    assert.match(byId.get(record.id).detail, /pausa/i)
    assert.ok(byId.get(record.id).detail.includes(record.detail))
  }
  assert.deepEqual(byId.get(upcoming.id), upcoming)
  assert.deepEqual(byId.get(ordinary.id), ordinary)
  assert.deepEqual(resumed.agenda.weekly[missed.date].teams[0].tasks, [])
  assert.deepEqual(resumed.agenda.teams[0].tasks.map(task => task.historyId), [ordinary.id])
  assert.deepEqual(resumed.agenda.weekly[moved.date].teams, resumed.agenda.teams)
  assert.deepEqual(resumed.agenda.weekly[upcoming.date], previous.agenda.weekly[upcoming.date])
  assert.equal(cutoff(resumed.history, { id: 'tecnico' }, today, resumed.agenda.weekly), '')
  const { overdueVehicleControls } = await import('../src/domain/technicians/technician-history.mjs')
  assert.deepEqual(overdueVehicleControls(resumed.history, today, resumed.agenda.weekly), [])
  assert.deepEqual(resumeVehicleControls(structuredClone(resumed), resumed, today), resumed)

  const secondPause = structuredClone(resumed)
  secondPause.agenda.weekly._vehicleControls.paused = true
  const secondResume = resume(secondPause, '2026-12-21')
  assert.equal(secondResume.history.find(record => record.id === upcoming.id).status, 'Cancelado')
  for (const record of [missed, moved]) assert.deepEqual(secondResume.history.find(row => row.id === record.id), byId.get(record.id))
})

test('reanudar conserva informes finales y la evidencia parcial de los controles vencidos', async () => {
  const friday = '2026-12-04'
  const timestamp = friday + 'T18:45:00Z'
  const records = [
    control(friday, 'informado', { status: 'Completado', technicalObservation: 'Luces verificadas', technicalReportedAt: timestamp }),
    control(friday, 'odometro', { vehicleMileage: 12500 }),
    control(friday, 'foto', { vehiclePhotoUrl: '/archivos/inspeccion.jpg' }),
    control(friday, 'iniciado', { startedAt: timestamp }),
  ]
  const state = await pausedState(records, friday)
  const resumed = resume(state, '2026-12-07')
  const [reported, ...partial] = resumed.history
  assert.deepEqual(reported, records[0])
  for (const record of partial) {
    assert.equal(record.status, 'Cancelado')
    assert.match(record.detail, /pausa/i)
  }
  assert.equal(partial[0].vehicleMileage, 12500)
  assert.equal(partial[1].vehiclePhotoUrl, '/archivos/inspeccion.jpg')
  assert.equal(partial[2].startedAt, timestamp)
  const reportedTask = state.agenda.teams[0].tasks[0]
  assert.deepEqual(resumed.agenda.weekly[friday].teams[0].tasks, [reportedTask])
  assert.deepEqual(resumed.agenda.teams[0].tasks, [reportedTask])
})

test('un control del próximo viernes fechado por error en el pasado vuelve a la jornada hábil correspondiente', async () => {
  const record = control('2026-12-18', 'ford', { date: '2026-12-10' })
  const state = await pausedState([record], record.date)
  state.agenda.weekly._holidayOverrides = { '2026-12-18': { status: 'closed' } }
  const resumed = resume(state, '2026-12-14')
  const [scheduled] = resumed.history
  assert.equal(scheduled.id, record.id)
  assert.equal(scheduled.status, 'Pendiente')
  assert.equal(scheduled.date, '2026-12-17')
  assert.equal(scheduled.time, '16:45')
  assert.deepEqual(resumed.agenda.weekly[record.date].teams[0].tasks, [])
  assert.deepEqual(resumed.agenda.teams[0].tasks, [])
  assert.deepEqual(resumed.agenda.weekly[scheduled.date].teams[0].tasks.map(task => task.historyId), [record.id])
})

test('una tarea antigua sin fila de Historial guarda la causa y deja de ocupar lugar en las agendas', async () => {
  const { hiddenAgendaControl } = require('../api/_lib/vehicle-controls-pause.cjs')
  const { serviceSlotReleased } = require('../api/_lib/service-slot-released.cjs')
  const record = control('2026-12-04', 'ford')
  const previous = await pausedState([record], record.date)
  previous.history = []
  previous.agenda.teams[0].tasks[0].vehicleMileage = 12200
  const resumed = resume(previous, '2026-12-07')
  for (const plan of [resumed.agenda, resumed.agenda.weekly[record.date]]) {
    const task = plan.teams[0].tasks[0]
    assert.equal(task.status, 'Cancelado')
    assert.match(task.detail, /pausa/i)
    assert.equal(hiddenAgendaControl(task, resumed.agenda.weekly), true)
    assert.equal(serviceSlotReleased(task, record.date), true)
  }
  assert.equal(resumed.agenda.teams[0].tasks[0].vehicleMileage, 12200)
})

test('reanudar recupera la lectura parcial y el informe que solo constaban en las tareas', async () => {
  const friday = '2026-12-04'
  const controls = [control(friday, 'parcial'), control(friday, 'reportado')]
  const state = await pausedState(controls, friday)
  const [weeklyPartial] = state.agenda.weekly[friday].teams[0].tasks
  delete weeklyPartial.historyId // Vinculación antigua solo por sourceTaskId.
  weeklyPartial.vehicleMileage = 0
  const [dailyPartial, dailyReported] = state.agenda.teams[0].tasks
  dailyPartial.vehiclePhotoUrl = '/evidencia/vehiculo.jpg'
  Object.assign(dailyReported, {
    technicalStatus: 'Completado', technicalObservation: 'Cubiertas verificadas',
    vehicleControlReportedAt: '2026-12-04T18:52:00Z',
  })
  const resumed = resume(state, '2026-12-07')
  const [partial, reported] = resumed.history
  assert.equal(partial.status, 'Cancelado')
  assert.equal(partial.vehicleMileage, 0)
  assert.equal(partial.vehiclePhotoUrl, dailyPartial.vehiclePhotoUrl)
  assert.equal(reported.status, 'Completado')
  assert.equal(reported.technicalObservation, dailyReported.technicalObservation)
  assert.equal(reported.vehicleControlReportedAt, dailyReported.vehicleControlReportedAt)
})

test('si se reanuda el viernes se respeta el cierre de la jornada en horario argentino', async () => {
  const record = control('2026-12-18', 'ford')
  const state = await pausedState([record], record.date)
  for (const [time, status] of [['18:30', 'Pendiente'], ['18:50', 'Pendiente'], ['19:05', 'Cancelado']]) {
    const resumed = resume(state, new Date(record.date + 'T' + time + ':00Z'))
    assert.equal(resumed.history[0].status, status, time)
  }
  state.agenda.weekly._holidayOverrides = { [record.date]: { status: 'closed' } }
  assert.equal(resume(state, new Date('2026-12-18T12:00:00Z')).history[0].status, 'Cancelado')
})
