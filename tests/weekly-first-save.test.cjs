const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { mirrorWeeklyServiceCreations } = require('../api/_lib/weekly-service-creation-mirror.cjs')
async function fixture() {
  const { weeklyServiceCreationOperations } = await import('../src/features/state/application/weekly-service-create.mjs')
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const day = '2026-11-06'
  const team = { teamId: 'team-1', memberIds: ['tech'], members: ['Técnico'], tasks: [] }
  const task = { taskId: 'task-new', historyId: 'work-new', time: '10:00', service: 'Service' }
  const record = { ...task, id: 'work-new', date: day, teamId: team.teamId, technicianIds: team.memberIds }
  const server = { revision: 1, customers: [], history: [], agenda: { date: '2026-11-05', teams: [], weekly: {} } }
  return { create: weeklyServiceCreationOperations, edit: weeklyServiceOperations, day, team, task, record, server, command: { day, team, task, record } }
}
test('primer servicio materializa el día reconstruido en pantalla sin conflicto de otra sesión', async () => {
  const f = await fixture(), display = structuredClone(f.server)
  display.agenda.weekly[f.day] = { teams: [f.team] }
  assert.throws(() => applyStateOperations(f.server, f.edit(display, f.command)), { code: 'RECORD_WRITE_CONFLICT' })
  const operations = f.create(f.server, 1, f.command)
  const saved = applyStateOperations(f.server, operations)
  assert.deepEqual(saved.history, [f.record])
  assert.deepEqual(saved.agenda.weekly[f.day].teams[0].tasks, [f.task])
  assert.deepEqual(applyStateOperations(saved, operations), saved)
})
test('primer servicio guarda equipo nuevo, equipo sin tasks y proyección diaria vacía', async () => {
  for (const mode of ['team', 'tasks', 'daily']) {
    const f = await fixture()
    if (mode === 'team') f.server.agenda.weekly[f.day] = { teams: [] }
    if (mode === 'tasks') { const { tasks, ...team } = f.team; f.server.agenda.weekly[f.day] = { teams: [team] } }
    if (mode === 'daily') f.server.agenda.date = f.day
    const operations = f.create(f.server, 1, f.command)
    const saved = mirrorWeeklyServiceCreations(applyStateOperations(f.server, operations), f.server, operations)
    assert.equal(saved.history.length, 1)
    assert.equal(saved.agenda.weekly[f.day].teams[0].tasks[0].taskId, f.task.taskId)
    if (mode === 'daily') assert.equal(saved.agenda.teams[0].tasks[0].taskId, f.task.taskId)
  }
})
test('el alta sigue la fecha diaria vigente cuando otra sesión cambia de día durante la carga', async () => {
  for (const wasOpen of [true, false]) {
    for (const sameTeamId of [true, false]) {
      const f = await fixture()
      const otherDay = '2026-11-07'
      f.server.agenda.date = wasOpen ? f.day : otherDay
      f.server.agenda.teams = [structuredClone(f.team)]
      f.server.agenda.weekly[f.day] = { teams: [structuredClone(f.team)] }
      const operations = f.create(f.server, 1, f.command)
      const current = structuredClone(f.server)
      current.agenda.date = wasOpen ? otherDay : f.day
      current.agenda.teams = [{ ...f.team, teamId: sameTeamId ? f.team.teamId : 'otro', tasks: [{ taskId: 'previo', time: '08:00' }] }]
      const saved = mirrorWeeklyServiceCreations(applyStateOperations(current, operations), current, operations)
      assert.deepEqual(saved.history, [f.record])
      assert.deepEqual(saved.agenda.weekly[f.day].teams[0].tasks, [f.task])
      if (wasOpen) assert.deepEqual(saved.agenda.teams, current.agenda.teams)
      else {
        assert.deepEqual(saved.agenda.teams.find(team => team.teamId === f.team.teamId).tasks.at(-1), f.task)
        assert.equal(saved.agenda.teams.flatMap(team => team.tasks).length, 2)
      }
    }
  }
})
test('un planificador semanal puede agendar con materiales sobre un equipo mensual aunque la agenda diaria esté vacía y oculta', async () => {
  const { fixture: planningState, day } = require('./helpers/planning-click-fixture.cjs')
  const { visibleStateForUser, authorizeIncomingState, normalizeStateForSave, validateState } = require('../api/_lib/core.cjs')
  const { prepareServiceMaterials } = require('../api/_lib/service-materials.cjs')
  const state = planningState()
  const monthlyTeam = { teamId: 'mensual', label: 'Equipo 1', memberIds: ['two'], members: ['two Técnico'] }
  state.agenda.weekly._monthlyTeams = { [day.slice(0, 7)]: { teams: [monthlyTeam] } }
  state.agenda.teams = []
  const actor = { id: 'planner', roleCode: 'custom', permissions: { __catalogV2: true, 'weekly.view': true, 'planning.create': true, 'records.read': true } }
  const visible = visibleStateForUser(state, actor)
  const product = require('../shared/product-catalog.cjs').baseProducts.find(item => item.brand === 'Garnet' && item.kind === 'sensor')
  const record = { id: 'work-new', sourceTaskId: 'task-new', date: day, time: '11:00', estimatedMinutes: 60, status: 'Pendiente', service: 'Servicio', serviceId: 's', technicianIds: monthlyTeam.memberIds, technicians: monthlyTeam.members, teamId: monthlyTeam.teamId, team: monthlyTeam.label, materials: [{ productId: product.id, quantity: 2 }] }
  const task = { ...record, taskId: record.sourceTaskId, historyId: record.id }
  const f = await fixture()
  const operations = f.create(visible, visible.revision, { day, team: monthlyTeam, task, record })
  assert.ok(operations.every(op => op.path[0] !== 'agenda' || op.path[1] !== 'teams'))
  const authorized = authorizeIncomingState(applyStateOperations(visible, operations), state, actor)
  const mirrored = mirrorWeeklyServiceCreations(authorized, state, operations)
  const saved = normalizeStateForSave(prepareServiceMaterials(mirrored, state).apply([]), state)
  validateState(saved, state)
  for (const copy of [saved.history.find(item => item.id === record.id), saved.agenda.weekly[day].teams.find(team => team.teamId === monthlyTeam.teamId).tasks[0], saved.agenda.teams[0].tasks[0]]) {
    assert.equal(copy.materials[0].productId, product.id)
    assert.equal(copy.materials[0].quantity, 2)
  }
  assert.deepEqual(visibleStateForUser(saved, actor).agenda.teams, [])
})
test('una tarjeta Disponible ya guardada puede convertirse en servicio una sola vez y conserva su protección frente a ediciones', async () => {
  const f = await fixture()
  const slot = { taskId: f.task.taskId, manualSlot: true, time: f.task.time }
  const team = { ...f.team, tasks: [slot] }
  f.server.agenda = { date: f.day, teams: [structuredClone(team)], weekly: { [f.day]: { teams: [team] } } }
  const command = { ...f.command, baseTask: structuredClone(slot) }
  const operations = f.create(f.server, 1, command)
  const saved = mirrorWeeklyServiceCreations(applyStateOperations(f.server, operations), f.server, operations)
  assert.deepEqual(saved.agenda.teams[0].tasks, [f.task])
  assert.deepEqual(saved.agenda.weekly[f.day].teams[0].tasks, [f.task])
  assert.deepEqual(saved.history, [f.record])
  const concurrent = structuredClone(f.server)
  concurrent.agenda.teams[0].tasks[0].detail = 'Cambio local de otro usuario'
  assert.throws(() => mirrorWeeklyServiceCreations(applyStateOperations(concurrent, operations), concurrent, operations), { code: 'RECORD_WRITE_CONFLICT' })
  concurrent.agenda.weekly[f.day].teams[0].tasks[0].time = '12:00'
  assert.throws(() => applyStateOperations(concurrent, f.create(concurrent, 1, command)), { code: 'RECORD_WRITE_CONFLICT' })
  concurrent.agenda.weekly[f.day].teams[0].tasks = []
  assert.throws(() => f.create(concurrent, 1, command), /tarjeta original/)
  assert.throws(() => applyStateOperations(concurrent, operations), { code: 'RECORD_WRITE_CONFLICT' })
})
test('alta no incluye borradores de otros servicios y conserva altas concurrentes', async () => {
  const f = await fixture()
  const operations = f.create(f.server, 1, f.command)
  const concurrent = structuredClone(f.server)
  const other = { taskId: 'other', historyId: 'work-other', time: '12:00' }
  concurrent.agenda.weekly[f.day] = { teams: [{ ...f.team, tasks: [other] }] }
  concurrent.history.push({ id: 'work-other' })
  const saved = applyStateOperations(concurrent, operations)
  assert.equal(saved.history.length, 2)
  assert.equal(saved.agenda.weekly[f.day].teams[0].tasks.length, 2)
  assert.ok(saved.agenda.weekly[f.day].teams[0].tasks.some(task => task.taskId === 'other'))
})
test('cambios reales de equipo y eliminación concurrente siguen protegidos', async () => {
  const f = await fixture()
  f.server.agenda.weekly[f.day] = { teams: [f.team] }
  const operations = f.create(f.server, 1, f.command)
  for (const remove of [false, true]) {
    const concurrent = structuredClone(f.server)
    if (remove) concurrent.agenda.weekly[f.day].teams = []
    else concurrent.agenda.weekly[f.day].teams[0].memberIds = ['other-tech']
    assert.throws(() => applyStateOperations(concurrent, operations), { code: 'RECORD_WRITE_CONFLICT' })
  }
})
test('el alta en un equipo mensual compara sólo su dotación efectiva y admite otros servicios concurrentes', async () => {
  const f = await fixture()
  const month = f.day.slice(0, 7)
  const template = { ...f.team, label: 'Equipo 1' }
  f.server.agenda.weekly._monthlyTeams = { [month]: { teams: [template, { ...template, teamId: 'otro' }] } }
  const operations = f.create(f.server, 1, f.command)
  assert.deepEqual(operations.find(op => op.path[0] === 'history').inheritedCrew, { source: 'monthly', memberIds: ['tech'] })
  assert.ok(operations.every(op => !op.path.includes('_monthlyTeams')))
  for (const change of ['cambio', 'baja']) {
    const stale = structuredClone(f.server)
    const teams = stale.agenda.weekly._monthlyTeams[month].teams
    if (change === 'cambio') teams[0].memberIds = ['nuevo']
    else teams.shift()
    assert.throws(() => applyStateOperations(stale, operations), { code: 'RECORD_WRITE_CONFLICT' })
    assert.equal(stale.history.length, 0)
  }
  const parallel = structuredClone(f.server)
  parallel.agenda.weekly._monthlyTeams[month].teams[1].memberIds = ['nuevo']
  parallel.agenda.weekly[f.day] = { teams: [{ ...template, tasks: [{ taskId: 'otro', time: '12:00' }] }] }
  const saved = applyStateOperations(parallel, operations)
  assert.deepEqual(saved.agenda.weekly[f.day].teams[0].tasks.map(task => task.taskId).sort(), ['otro', f.task.taskId].sort())
  assert.deepEqual(saved.agenda.weekly._monthlyTeams, parallel.agenda.weekly._monthlyTeams)
})
test('el alta del sábado compara únicamente la guardia efectiva, tanto programada como sugerida', async () => {
  const { fixture: planningState } = require('./helpers/planning-click-fixture.cjs')
  const { visibleStateForUser, authorizeIncomingState } = require('../api/_lib/core.cjs')
  const { assignGuardToEmptySaturday } = await import('../src/features/agenda/application/agenda-model.mjs')
  const f = await fixture(), day = '2099-01-10', year = day.slice(0, 4)
  for (const configured of [false, true]) {
    const state = planningState()
    const weekly = state.agenda.weekly
    if (configured) weekly._annualGuards = { [year]: { startDate: day, rotation: [{ technicianId: 'one', name: 'one Técnico' }, { technicianId: 'two', name: 'two Técnico' }] } }
    const technicians = state.employees.map(employee => ({ ...employee, roleCode: 'technician' }))
    const [team] = assignGuardToEmptySaturday([{ teamId: 'history-guard-' + day, label: 'Equipo 1', tasks: [] }], day, weekly, technicians)
    const task = { ...f.task, time: '09:00' }, record = { ...f.record, date: day, teamId: team.teamId, technicianIds: team.memberIds }
    const operations = f.create(state, state.revision, { day, team, record, task })
    assert.ok(operations.every(op => !op.path.includes('_annualGuards')))
    assert.deepEqual(operations.find(op => op.path[0] === 'history').inheritedCrew, { source: 'guard', memberIds: team.memberIds })
    const actor = { id: 'planner', roleCode: 'custom', permissions: { __catalogV2: true, 'weekly.view': true, 'planning.create': true, 'records.read': true } }
    const visible = visibleStateForUser(state, actor)
    const proposed = applyStateOperations(visible, f.create(visible, visible.revision, { day, team, record, task }))
    const authorized = authorizeIncomingState(proposed, state, actor)
    assert.deepEqual(authorized.agenda.weekly[day].teams[0].memberIds, team.memberIds)
    assert.equal(JSON.stringify(authorized.agenda.weekly._annualGuards), JSON.stringify(state.agenda.weekly._annualGuards))
    proposed.agenda.weekly[day].teams[0].memberIds = ['tercero']
    assert.throws(() => authorizeIncomingState(proposed, state, actor), /planning.teams.create/)
    const stale = structuredClone(state)
    if (configured) stale.agenda.weekly._annualGuards[year].rotation.reverse()
    else stale.employees.find(employee => employee.id === team.memberIds[0]).status = 'Inactivo'
    assert.throws(() => applyStateOperations(stale, operations), { code: 'RECORD_WRITE_CONFLICT' })
    const concurrent = structuredClone(state)
    if (configured) concurrent.agenda.weekly._annualGuards[year].rotation.push({ technicianId: 'otro', name: 'Otro' })
    const otherTask = { ...task, taskId: 'otro', historyId: 'work-otro', time: '10:30' }
    const other = f.create(state, state.revision, { day, team, task: otherTask, record: { ...record, id: otherTask.historyId, taskId: otherTask.taskId } })
    const saved = applyStateOperations(applyStateOperations(concurrent, other), operations)
    assert.equal(saved.agenda.weekly[day].teams.length, 1)
    assert.deepEqual(saved.agenda.weekly[day].teams[0].tasks.map(card => card.taskId).sort(), ['otro', task.taskId].sort())
    assert.deepEqual(saved.agenda.weekly._annualGuards, concurrent.agenda.weekly._annualGuards)
  }
})
test('reservas y clientes nuevos se crean atómicamente junto con el servicio', async () => {
  const f = await fixture(), customer = { customerId: 'new-client', account: 'CLI-1', name: 'CLIENTE' }
  const command = { ...f.command, customer, record: { ...f.record, customerId: customer.customerId } }
  const saved = applyStateOperations(f.server, f.create(f.server, 1, command))
  assert.deepEqual(saved.customers, [customer])
  assert.equal(saved.history[0].customerId, customer.customerId)
  assert.throws(() => f.create(f.server, 2, command), /actualizarse/)
  assert.throws(() => f.create(f.server, 1, { ...command, baseRecord: f.record }), /servicios nuevos/)
})

test('agendar un servicio no lee fichas, informes ni planes de otras fechas', async () => {
  const { server, create, day, team, command } = await fixture()
  const unexpectedRead = () => assert.fail('Se leyó información ajena al servicio')
  server.agenda.weekly[day] = { teams: [team] }
  Object.defineProperty(server.agenda.weekly, '2026-10-22', { enumerable: true, get: unexpectedRead })
  Object.defineProperty(server, 'customers', { enumerable: true, get: unexpectedRead })
  server.history.push({ id: 'previo', get technicalObservation() { return unexpectedRead() } })
  const operations = create(server, 1, command)
  assert.equal(operations.filter(op => op.path[0] === 'history').length, 1)
  assert.ok(operations.some(op => op.path[2] === day && op.after === command.task))
  assert.deepEqual(team.tasks, [])
  server.history.push({ id: 'previo' })
  assert.throws(() => create(server, 1, command), /identificador único/)
})

test('el primer servicio puede crear el contenedor de agenda en una base vacía', async () => {
  for (const initial of [null, undefined]) {
    const { server, create, day, command } = await fixture()
    if (initial === null) server.agenda = null
    else delete server.agenda
    const saved = applyStateOperations(server, create(server, 1, command))
    assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].taskId, command.task.taskId)
    assert.deepEqual(saved.history, [command.record])
  }
})
