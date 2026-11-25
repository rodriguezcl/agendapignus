const test = require('node:test')
const assert = require('node:assert/strict')
const { reconcileNewTechnicians } = require('../api/_lib/onboard-technicians.cjs')
const { guardForDate } = require('../api/_lib/annual-guard-rotation.cjs')
const { synchronizeTeamServiceAssignments } = require('../api/_lib/team-service-assignments.cjs')

const today = '2026-11-25'
const technician = (id, extra = {}) => ({ id, name: id.toUpperCase(), roleId: 'technical', status: 'Activo', ...extra })
const rotation = ['a', 'b', 'c'].map(id => ({ technicianId: id, name: id.toUpperCase() }))
const teams = () => [
  { teamId: 'pair', label: 'Equipo 1', memberIds: ['a', 'b'], members: ['A', 'B'] },
  { teamId: 'solo', label: 'Equipo 2', memberIds: ['c'], members: ['C'] }
]
function fixture() {
  const record = { id: 'work', sourceTaskId: 'task', date: today, teamId: 'solo', technicianIds: ['c'], technicians: ['C'], status: 'Pendiente', detail: 'Conservar', serviceJourney: { id: 'work', index: 1, total: 2 } }
  const plan = { teams: [{ ...teams()[1], tasks: [{ ...record, taskId: 'task', historyId: record.id }] }] }
  return {
    roles: [{ id: 'technical', code: 'technician', name: 'Técnico' }, { id: 'admin', code: 'administrator', name: 'Administrador' }],
    employees: ['a', 'b', 'c'].map(id => technician(id)), vehicles: [], history: [record],
    agenda: { date: today, teams: structuredClone(plan.teams), weekly: {
      _monthlyTeams: { '2026-10': { teams: teams() }, '2026-11': { teams: teams() }, '2026-12': { teams: teams() } },
      _annualGuards: { 2025: { rotation, startDate: '2025-01-04' }, 2026: { rotation, startDate: '2026-01-03' }, 2027: { rotation, startDate: '2027-01-02' } },
      [today]: plan
    } }
  }
}
const withNew = state => ({ ...structuredClone(state), employees: [...structuredClone(state.employees), technician('d')] })

test('alta incorpora a menor dotación actual y futura, sincroniza las proyecciones y conserva identidad', () => {
  const previous = fixture(), next = withNew(previous), baseline = structuredClone(next)
  const result = reconcileNewTechnicians(next, previous, today)
  for (const month of ['2026-11', '2026-12']) {
    assert.deepEqual(result.agenda.weekly._monthlyTeams[month].teams[0], previous.agenda.weekly._monthlyTeams[month].teams[0])
    assert.deepEqual(result.agenda.weekly._monthlyTeams[month].teams[1].memberIds, ['c', 'd'])
  }
  assert.deepEqual(result.agenda.weekly._monthlyTeams['2026-10'], previous.agenda.weekly._monthlyTeams['2026-10'])
  assert.deepEqual(result.agenda.weekly[today].teams[0].memberIds, ['c', 'd'])
  assert.deepEqual(result.agenda.teams[0].tasks[0].technicianIds, ['c', 'd'])
  assert.deepEqual(result.history[0], { ...previous.history[0], technicianIds: ['c', 'd'], technicians: ['C', 'D'] })
  assert.deepEqual(next, baseline)
  assert.deepEqual(reconcileNewTechnicians(result, previous, today), result, 'Reintentar no agrega técnicos ni versiones duplicadas')
  assert.equal(reconcileNewTechnicians(result, result, today), result)
})

test('reactivación y cambio a Técnico son altas elegibles; función técnica adicional no lo es', () => {
  for (const old of [technician('d', { status: 'Inactivo' }), technician('d', { roleId: 'admin', technicalEnabled: true })]) {
    const previous = fixture(); previous.employees.push(old)
    const next = structuredClone(previous); next.employees.at(-1).status = 'Activo'; next.employees.at(-1).roleId = 'technical'
    assert.deepEqual(reconcileNewTechnicians(next, previous, today).agenda.weekly._monthlyTeams['2026-11'].teams[1].memberIds, ['c', 'd'])
  }
  for (const added of [technician('d', { status: 'Inactivo' }), technician('d', { roleId: 'admin', technicalEnabled: true })]) {
    const previous = fixture(), next = structuredClone(previous); next.employees.push(added)
    assert.equal(reconcileNewTechnicians(next, previous, today), next)
  }
})

test('los días históricos, informes, trabajo iniciado y excepciones no se reasignan', () => {
  const mutations = [
    state => { state.agenda.weekly[today].teams[0].guardOverride = true },
    state => { state.agenda.weekly[today].teams[0].monthlyStaffingOverride = true },
    state => { state.agenda.teams[0].monthlyStaffingOverride = true },
    state => { state.history[0].startedAt = `${today}T12:00:00Z` },
    state => { state.history[0].technicalObservation = 'Informe legado' },
    state => { state.history[0].technicalReport = { notes: 'Informe técnico' } },
    state => { state.history[0].technicalReportedAt = `${today}T12:00:00Z` },
    state => { state.history[0].workCompletion = { corrections: [{ reason: 'Corrección administrativa' }] } },
    state => { state.history[0].status = 'Completado' },
    state => { state.history[0].status = 'Avance registrado' },
    state => { state.history[0].technicianIds = ['b'] },
    state => { state.agenda.weekly[today].teams[0].tasks[0].technicianIds = ['b'] }
  ]
  for (const mutate of mutations) {
    const previous = fixture(); mutate(previous)
    const result = synchronizeTeamServiceAssignments(reconcileNewTechnicians(withNew(previous), previous, today), previous)
    assert.deepEqual(result.agenda.weekly[today], previous.agenda.weekly[today])
    assert.deepEqual(result.agenda.teams, previous.agenda.teams)
    assert.deepEqual(result.history, previous.history)
  }
  const previous = fixture()
  previous.agenda.weekly['2026-11-24'] = structuredClone(previous.agenda.weekly[today])
  previous.agenda.date = '2026-11-24'
  previous.history[0].date = '2026-11-24'
  const result = reconcileNewTechnicians(withNew(previous), previous, today)
  assert.deepEqual(result.agenda.weekly['2026-11-24'], previous.agenda.weekly['2026-11-24'])
  assert.deepEqual(result.agenda.teams, previous.agenda.teams)
  assert.deepEqual(result.history, previous.history)
})

test('la incorporación no transfiere responsabilidad de controles ni datos de cobranza', () => {
  const previous = fixture()
  const control = { id: 'control', sourceTaskId: 'control-task', date: today, teamId: 'solo', status: 'Pendiente', vehicleControl: true, vehicleId: 'ka', technicianIds: ['b'], technicians: ['B'], collection: { status: 'confirmed' } }
  previous.history.push(control)
  previous.agenda.weekly[today].teams[0].tasks.push({ ...control, taskId: control.sourceTaskId, historyId: control.id })
  previous.agenda.teams = structuredClone(previous.agenda.weekly[today].teams)
  previous.agenda.weekly._monthlyTeams['2026-11'].vehicleAssignments = [{ vehicleId: 'ka', technicianId: 'b' }]
  const result = synchronizeTeamServiceAssignments(reconcileNewTechnicians(withNew(previous), previous, today), previous)
  assert.deepEqual(result.history[1], control)
  assert.deepEqual(result.agenda.weekly[today].teams[0].tasks[1], previous.agenda.weekly[today].teams[0].tasks[1])
  assert.deepEqual(result.agenda.weekly._monthlyTeams['2026-11'].vehicleAssignments, previous.agenda.weekly._monthlyTeams['2026-11'].vehicleAssignments)
})

test('versiona guardias desde el próximo sábado, preservando todos los turnos anteriores', () => {
  const previous = fixture(), result = reconcileNewTechnicians(withNew(previous), previous, today)
  const old = previous.agenda.weekly._annualGuards[2026], config = result.agenda.weekly._annualGuards[2026]
  assert.equal(config.effectiveFrom, '2026-11-28')
  assert.deepEqual(guardForDate('2026-11-28', config), guardForDate('2026-11-28', old))
  for (let date = new Date('2026-01-03T12:00:00Z'); date < new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 7)) {
    const key = date.toISOString().slice(0, 10)
    assert.deepEqual(guardForDate(key, config), guardForDate(key, old))
  }
  assert.equal(guardForDate('2026-12-19', config).technicianId, 'd')
  assert.deepEqual(result.agenda.weekly._annualGuards[2025], previous.agenda.weekly._annualGuards[2025])
  assert.equal(result.agenda.weekly._annualGuards[2027].effectiveFrom, '2027-01-02')
  const saturdayResult = reconcileNewTechnicians(withNew(previous), previous, '2026-11-28')
  assert.equal(saturdayResult.agenda.weekly._annualGuards[2026].effectiveFrom, '2026-12-05')
  assert.deepEqual(guardForDate('2026-11-28', saturdayResult.agenda.weekly._annualGuards[2026]), guardForDate('2026-11-28', old))
})

test('guardias materializadas y adelantadas se actualizan; cambios manuales e informes se conservan', () => {
  for (const exception of ['', 'guardOverride', 'manualTask', 'report']) {
    const previous = fixture(), date = '2026-12-19'
    const guard = guardForDate(date, previous.agenda.weekly._annualGuards[2026])
    const record = { id: 'guard-work', sourceTaskId: 'guard-task', date, teamId: 'guard', status: 'Pendiente', technicianIds: [guard.technicianId], technicians: [guard.name], detail: 'Guardia' }
    const team = { teamId: 'guard', label: 'Equipo 1', memberIds: [guard.technicianId], members: [guard.name], tasks: [{ ...record, taskId: record.sourceTaskId, historyId: record.id }] }
    if (exception === 'guardOverride') team.guardOverride = true
    if (exception === 'manualTask') record.technicianIds = ['manual']
    if (exception === 'report') record.technicalObservation = 'Trabajo informado'
    previous.history.push(record)
    previous.agenda.weekly[date] = { teams: [team] }
    previous.agenda.date = date; previous.agenda.teams = structuredClone([team])
    const friday = { ...record, id: 'friday-work', sourceTaskId: 'friday-task', date: '2026-12-18', teamId: 'advance', technicianIds: [guard.technicianId] }
    previous.history.push(friday)
    previous.agenda.weekly[friday.date] = { teams: [{ ...structuredClone(team), teamId: 'advance', label: `Guardia · ${guard.name}`, tasks: [{ ...friday, taskId: friday.sourceTaskId, historyId: friday.id }] }] }
    const result = synchronizeTeamServiceAssignments(reconcileNewTechnicians(withNew(previous), previous, today), previous)
    if (exception) {
      assert.deepEqual(result.history.find(item => item.id === record.id), record)
      assert.deepEqual(result.agenda.weekly[date], previous.agenda.weekly[date])
    } else {
      assert.deepEqual(result.history.find(item => item.id === record.id).technicianIds, ['d'])
      assert.deepEqual(result.agenda.teams[0].memberIds, ['d'])
      assert.deepEqual(result.history.find(item => item.id === friday.id).technicianIds, ['d'])
      assert.equal(result.agenda.weekly[friday.date].teams[0].label, 'Guardia · D')
    }
  }
})

test('semillas sólo para períodos actuales ausentes; respeta configuraciones vacías y días manuales', () => {
  const previous = fixture()
  delete previous.agenda.weekly._monthlyTeams['2026-11']
  delete previous.agenda.weekly._annualGuards[2026]
  delete previous.agenda.weekly._monthlyTeams['2026-12']
  delete previous.agenda.weekly._annualGuards[2027]
  const result = reconcileNewTechnicians(withNew(previous), previous, today)
  const ids = result.agenda.weekly._monthlyTeams['2026-11'].teams.flatMap(team => team.memberIds).sort()
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'])
  assert.deepEqual(result.agenda.weekly[today], previous.agenda.weekly[today])
  assert.deepEqual(result.history, previous.history)
  assert.equal(result.agenda.weekly._monthlyTeams['2026-12'], undefined)
  assert.equal(result.agenda.weekly._annualGuards[2027], undefined)
  assert.equal(guardForDate('2026-11-21', result.agenda.weekly._annualGuards[2026]), null)
  assert.equal(result.agenda.weekly._annualGuards[2026].effectiveFrom, '2026-11-28')
  const explicit = fixture()
  explicit.agenda.weekly._monthlyTeams['2026-11'] = { teams: [] }
  explicit.agenda.weekly._annualGuards[2026] = { rotation: [] }
  const unchanged = reconcileNewTechnicians(withNew(explicit), explicit, today)
  assert.deepEqual(unchanged.agenda.weekly._monthlyTeams['2026-11'], { teams: [] })
  assert.deepEqual(unchanged.agenda.weekly._annualGuards[2026], { rotation: [] })
})

test('registra composición anterior, posterior y vigencia sin duplicar auditoría al reintentar', () => {
  const previous = fixture()
  const existingEvent = { id: 'manual-event', type: 'teams', before: [], after: [] }
  previous.agenda.weekly._monthlyTeams['2026-11'].configurationHistory = [existingEvent]
  const result = reconcileNewTechnicians(withNew(previous), previous, today)
  const monthly = result.agenda.weekly._monthlyTeams['2026-11'].configurationHistory
  assert.deepEqual(monthly[0], existingEvent)
  assert.equal(monthly.length, 2)
  assert.equal(monthly[1].type, 'teams')
  assert.equal(monthly[1].period, '2026-11')
  assert.equal(monthly[1].effectiveFrom, today)
  assert.deepEqual(monthly[1].before[1], { teamId: 'solo', label: 'Equipo 2', technicianIds: ['c'], technicians: ['C'] })
  assert.deepEqual(monthly[1].after[1], { teamId: 'solo', label: 'Equipo 2', technicianIds: ['c', 'd'], technicians: ['C', 'D'] })
  const annual = result.agenda.weekly._annualGuards[2026].configurationHistory[0]
  assert.equal(annual.type, 'guards')
  assert.equal(annual.period, '2026')
  assert.equal(annual.effectiveFrom, '2026-11-28')
  assert.deepEqual(annual.before[0], { position: 1, technicianId: 'a', technician: 'A' })
  assert.deepEqual(annual.after.at(-1), { position: 4, technicianId: 'd', technician: 'D' })
  for (const event of [monthly[1], annual]) {
    assert.equal(event.reason, 'Alta de técnico')
    assert.equal(event.user.name, 'Sistema')
    assert.ok(event.id)
    assert.ok(Number.isFinite(Date.parse(event.at)))
  }
  assert.deepEqual(reconcileNewTechnicians(result, previous, today), result)
  const empty = fixture()
  delete empty.agenda.weekly._monthlyTeams['2026-11']
  delete empty.agenda.weekly._annualGuards[2026]
  const seeded = reconcileNewTechnicians(withNew(empty), empty, today)
  assert.deepEqual(seeded.agenda.weekly._monthlyTeams['2026-11'].configurationHistory[0].before, [])
  assert.deepEqual(seeded.agenda.weekly._annualGuards[2026].configurationHistory[0].before, [])
})

test('alta raw usa nombre y apellido editados aunque name aún contenga el nombre anterior', () => {
  const previous = fixture(), next = withNew(previous)
  Object.assign(next.employees.at(-1), { name: 'Nombre anterior', firstName: '  Santiago  ', lastName: ' Castillo ' })
  const result = reconcileNewTechnicians(next, previous, today)
  assert.equal(result.agenda.weekly._monthlyTeams['2026-11'].teams[1].members.at(-1), 'Santiago Castillo')
  assert.equal(result.agenda.weekly._annualGuards[2026].rotation.at(-1).name, 'Santiago Castillo')
  assert.equal(result.history[0].technicians.at(-1), 'Santiago Castillo')
  delete next.agenda.weekly._monthlyTeams['2026-11']
  delete next.agenda.weekly._annualGuards[2026]
  const seeded = reconcileNewTechnicians(next, previous, today)
  assert.ok(seeded.agenda.weekly._monthlyTeams['2026-11'].teams.some(team => team.members.includes('Santiago Castillo')))
  assert.equal(seeded.agenda.weekly._annualGuards[2026].rotation.at(-1).name, 'Santiago Castillo')
})

test('mantiene sincronizados aliases legados sólo cuando existen en los equipos', () => {
  const previous = fixture()
  for (const team of [previous.agenda.weekly._monthlyTeams['2026-11'].teams[1], previous.agenda.weekly[today].teams[0], previous.agenda.teams[0]]) {
    team.technicianIds = [...team.memberIds]
    team.technicians = [...team.members]
  }
  const result = reconcileNewTechnicians(withNew(previous), previous, today)
  for (const team of [result.agenda.weekly._monthlyTeams['2026-11'].teams[1], result.agenda.weekly[today].teams[0], result.agenda.teams[0]]) {
    assert.deepEqual(team.technicianIds, ['c', 'd'])
    assert.deepEqual(team.technicians, ['C', 'D'])
  }
  assert.equal(Object.hasOwn(result.agenda.weekly._monthlyTeams['2026-12'].teams[1], 'technicianIds'), false)
})
