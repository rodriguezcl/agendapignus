const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { validateServiceJourneys, assertJourneyReport } = require('../api/_lib/service-journeys.cjs')
const { synchronizeJourneyIdentity } = require('../api/_lib/journey-identity.cjs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')

async function fourDayJob() {
  const { planServiceJourneyOperations } = await import('../src/features/state/application/service-journeys.mjs')
  const record = {
    id: 'work-first', sourceTaskId: 'first', date: '2026-11-24', time: '08:30',
    status: 'Pendiente', customerId: 'original-client', client: 'Cliente original',
    serviceId: 'cameras', service: 'Instalación de cámaras', estimatedMinutes: 120,
    teamId: 'team', team: 'Equipo 1', technicianIds: ['tech'], technicians: ['Técnico Uno']
  }
  const team = { teamId: 'team', label: 'Equipo 1', memberIds: ['tech'], members: ['Técnico Uno'], tasks: [] }
  const dates = ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']
  const initial = {
    revision: 1, customers: [], history: [record],
    agenda: { date: dates[2], teams: [structuredClone(team)], weekly: {} }
  }
  let nextId = 1
  const state = applyStateOperations(initial, planServiceJourneyOperations(initial, {
    base: record, today: '2026-11-23', teamsForDate: () => [team],
    visits: dates.map(date => ({ date, time: '08:30', teamId: team.teamId, estimatedMinutes: 120 })),
    createId: () => `visit-${++nextId}`
  }))
  for (const visit of state.history.slice(0, 2)) {
    Object.assign(visit, {
      status: 'Avance registrado', technicalStatus: 'Avance registrado',
      technicalObservation: `Informe original de ${visit.date}`,
      technicalReportedById: 'tech', technicalReportedByName: 'Técnico Uno',
      technicalReportedAt: `${visit.date}T13:30:00.000Z`,
      servicePhotoAttached: true, servicePhotoUrl: `/api/attachments/${visit.id}`
    })
    const card = state.agenda.weekly[visit.date].teams[0].tasks[0]
    Object.assign(card, visit)
  }
  return state
}

test('quitar la tercera jornada libera su horario, renumera la cuarta y permite otro cliente sin alterar informes', async () => {
  const { weeklyTaskRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const { weeklyServiceCreationOperations } = await import('../src/features/state/application/weekly-service-create.mjs')
  const { journeyLabel, journeyReportType } = await import('../src/domain/agenda/journey-progress.mjs')
  const before = await fourDayJob()
  const removed = before.history[2]
  const released = applyStateOperations(before, weeklyTaskRemovalOperations(before, {
    day: removed.date, teamId: removed.teamId, taskId: removed.sourceTaskId,
    historyId: removed.id, taskIndex: 0
  }))

  assert.equal(released.history[2].status, 'Cancelado')
  assert.deepEqual(released.agenda.teams[0].tasks, [])
  assert.deepEqual(released.agenda.weekly[removed.date].teams[0].tasks, [])
  assert.deepEqual(released.history.map(record => journeyLabel(record, released.history)), [
    'Jornada 1 de 3', 'Jornada 2 de 3', '', 'Jornada 3 de 3'
  ])
  assert.doesNotThrow(() => validateServiceJourneys(released, before))

  // Agregar servicio uses fresh identities: the replacement does not inherit
  // the old journey group, attachments, reports or completion state.
  const replacement = {
    id: 'work-replacement', sourceTaskId: 'replacement', date: removed.date,
    time: removed.time, estimatedMinutes: removed.estimatedMinutes,
    customerId: 'replacement-client', client: 'Otro cliente',
    serviceId: 'alarm', service: 'Service de alarma', status: 'Pendiente',
    teamId: removed.teamId, team: removed.team,
    technicianIds: [...removed.technicianIds], technicians: [...removed.technicians]
  }
  const task = { ...replacement, taskId: replacement.sourceTaskId, historyId: replacement.id }
  const command = { day: replacement.date, team: released.agenda.weekly[replacement.date].teams[0], task, record: replacement }
  const operations = weeklyServiceCreationOperations(released, released.revision, command)
  const saved = require('../api/_lib/weekly-service-creation-mirror.cjs').mirrorWeeklyServiceCreations(
    applyStateOperations(released, operations), released, operations
  )
  synchronizeJourneyIdentity(saved, released)
  assert.doesNotThrow(() => validateServiceJourneys(saved, released))
  assert.doesNotThrow(() => validateChangedAgendaSchedules(saved, released))

  for (const index of [0, 1, 3]) {
    assert.deepEqual(saved.history[index], before.history[index])
    assert.deepEqual(saved.agenda.weekly[before.history[index].date], before.agenda.weekly[before.history[index].date])
  }
  assert.deepEqual(saved.history[2].serviceJourney, removed.serviceJourney)
  assert.deepEqual(saved.history[4], replacement)
  assert.deepEqual(saved.agenda.teams[0].tasks, [task])
  assert.deepEqual(saved.agenda.weekly[replacement.date].teams[0].tasks, [task])
  assert.deepEqual(saved.agenda.weekly[replacement.date].removedTaskIds, [
    `task:${removed.sourceTaskId}`, `history:${removed.id}`
  ])
  const last = saved.history[3]
  assert.equal(journeyLabel(last, saved.history), 'Jornada 3 de 3')
  assert.equal(journeyReportType(last, saved.history), 'Completado')
  assert.doesNotThrow(() => assertJourneyReport(last, 'Completado', saved.history))
  // The replacement belongs to another job and does not prevent this closure.
  assert.equal(replacement.status, 'Pendiente')
})
