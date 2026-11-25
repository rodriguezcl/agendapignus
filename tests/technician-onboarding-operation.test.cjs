const test = require('node:test')
const assert = require('node:assert/strict')
const { applyEmployeeOperation } = require('../api/_lib/employee-operation.cjs')
const { authorizeIncomingState, normalizeStateForSave, publicEmployee, visibleStateForUser } = require('../api/_lib/core.cjs')

const admin = { id: 'admin', roleCode: 'administrator' }
const personnel = { id: 'personnel', roleCode: 'custom', permissions: { __catalogV2: true, 'employees.view': true, 'employees.create': true, 'employees.status': true, 'employees.role': true } }
const employee = (id, roleId = 'tech', status = 'Activo') => ({ id, firstName: id.toUpperCase(), lastName: 'Prueba', name: `${id.toUpperCase()} Prueba`, email: `${id}@example.test`, roleId, role: roleId === 'tech' ? 'Técnico' : 'Usuario', status, passwordHash: 'unchanged-hash' })
const operation = (before, after) => [{ path: ['employees', { key: 'id', id: String(after.id) }], before: before ? publicEmployee(before) : null, after, existed: Boolean(before), exists: true }]
const addDays = (day, amount) => { const result = new Date(`${day}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + amount); return result.toISOString().slice(0, 10) }
function fixture() {
  const now = new Date()
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12))
  while ([0, 5, 6].includes(first.getUTCDay())) first.setUTCDate(first.getUTCDate() + 1)
  const day = first.toISOString().slice(0, 10), month = day.slice(0, 7), year = day.slice(0, 4)
  const old = { id: 'old-report', sourceTaskId: 'old-task', date: '2020-01-02', time: '09:00', estimatedMinutes: 60, serviceId: 'alarm', service: 'Service de alarma', customerId: 'client', client: 'CLI-1 Cliente', teamId: 'team-a', technicianIds: ['a'], technicians: ['A Prueba'], status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Informe técnico original', completedAt: '2020-01-02T13:00:00.000Z' }
  const pending = { ...old, id: 'pending', sourceTaskId: 'pending-task', date: day, status: 'Pendiente', technicalStatus: '', technicalObservation: '', completedAt: '' }
  const control = { ...pending, id: 'control', sourceTaskId: 'control-task', time: '15:45', estimatedMinutes: 15, serviceId: 'vehicle-weekly-control', service: 'Control semanal de vehículo', vehicleControl: true, vehicleId: 'car', customerId: '', client: 'Vehículo' }
  const manual = { ...pending, id: 'manual', sourceTaskId: 'manual-task', date: addDays(day, 1), technicianIds: ['c'], technicians: ['C Prueba'] }
  const started = { ...pending, id: 'started', sourceTaskId: 'started-task', date: addDays(day, 2), startedAt: `${day}T12:00:00.000Z` }
  const teams = [{ teamId: 'team-a', label: 'Equipo 1', memberIds: ['a'], members: ['A Prueba'], tasks: [] }, { teamId: 'team-b', label: 'Equipo 2', memberIds: ['b', 'c'], members: ['B Prueba', 'C Prueba'], tasks: [] }]
  const plan = records => ({ teams: teams.map((team, index) => ({ ...team, tasks: index ? [] : records.map(record => ({ ...record, taskId: record.sourceTaskId, historyId: record.id })) })) })
  const state = {
    roles: [{ id: 'tech', name: 'Técnico', code: 'technician', permissions: { __catalogV2: true } }, { id: 'user', name: 'Usuario', code: 'user', permissions: { __catalogV2: true } }],
    employees: ['a', 'b', 'c'].map(id => employee(id)),
    services: [{ id: 'alarm', name: 'Service de alarma', estimatedMinutes: 60 }], vehicles: [{ id: 'car', brand: 'Ford', model: 'Ka', year: 2020, plate: 'AA123BB' }], customers: [{ customerId: 'client', account: 'CLI-1', name: 'Cliente' }], reviews: [], preferences: {},
    history: [old, pending, control, manual, started],
    agenda: { date: day, ...plan([pending, control]), weekly: {
      [old.date]: plan([old]), [day]: plan([pending, control]), [manual.date]: plan([manual]), [started.date]: plan([started]),
      _monthlyTeams: { '2020-01': { teams: structuredClone(teams) }, [month]: { teams: structuredClone(teams), vehicleAssignments: [{ vehicleId: 'car', technicianId: 'a', weeklyOverrides: {} }] } },
      _annualGuards: { [year]: { startDate: `${year}-01-01`, rotation: [{ technicianId: 'a', name: 'A Prueba' }, { technicianId: 'b', name: 'B Prueba' }] } }
    } }
  }
  return { state: normalizeStateForSave(state, state), day, month, year }
}

function assertIncorporated(next, before, { day, month, year }) {
  assert.deepEqual(next.agenda.weekly._monthlyTeams[month].teams[0].memberIds, ['a', 'new'])
  assert.deepEqual(next.agenda.weekly[day].teams[0].memberIds, ['a', 'new'])
  assert.deepEqual(next.agenda.teams[0].memberIds, ['a', 'new'])
  assert.deepEqual(next.history.find(record => record.id === 'pending').technicianIds, ['a', 'new'])
  assert.equal(next.agenda.weekly._annualGuards[year].rotation.filter(guard => guard.technicianId === 'new').length, 1)
  assert.deepEqual(next.agenda.weekly._monthlyTeams['2020-01'], before.agenda.weekly._monthlyTeams['2020-01'])
  for (const recordId of ['old-report', 'manual', 'started', 'control']) assert.deepEqual(next.history.find(record => record.id === recordId), before.history.find(record => record.id === recordId), `Conservar ${recordId}`)
  assert.deepEqual(next.agenda.weekly._monthlyTeams[month].vehicleAssignments, before.agenda.weekly._monthlyTeams[month].vehicleAssignments)
  assert.deepEqual(next.vehicles, before.vehicles)
}

test('el comando de alta incorpora equipos y guardias después de autorizar colaboradores', () => {
  const context = fixture(), original = structuredClone(context.state)
  const added = { ...employee('new'), passwordHash: undefined, password: 'NuevaClave123' }
  const next = applyEmployeeOperation(context.state, operation(null, added), personnel)
  assertIncorporated(next, context.state, context)
  assert.ok(next.employees.find(item => item.id === 'new').passwordHash)
  assert.equal(next.employees.find(item => item.id === 'new').password, undefined)
  assert.deepEqual(context.state, original)
  const employeeOnlyView = visibleStateForUser(next, personnel)
  assert.equal(employeeOnlyView.agenda, null, 'La incorporación derivada no concede lectura de la agenda')
  assert.deepEqual(employeeOnlyView.history, [])
  assert.throws(() => applyEmployeeOperation(context.state, operation(null, added), { ...personnel, permissions: { __catalogV2: true, 'employees.view': true } }), { permission: 'employees.create' })
})

test('reactivación y cambio al rol técnico incorporan una sola vez; editar el nombre no redistribuye', () => {
  for (const existing of [employee('new', 'tech', 'Inactivo'), employee('new', 'user')]) {
    const context = fixture()
    context.state.employees.push(existing)
    const next = applyEmployeeOperation(context.state, operation(existing, { ...publicEmployee(existing), roleId: 'tech', role: 'Técnico', status: 'Activo' }), personnel)
    assertIncorporated(next, context.state, context)
    const stored = next.employees.find(item => item.id === 'new')
    const unchanged = applyEmployeeOperation(next, operation(stored, publicEmployee(stored)), personnel)
    assert.deepEqual(unchanged.agenda, next.agenda)
    assert.deepEqual(unchanged.history, next.history)
    const renamed = applyEmployeeOperation(next, operation(stored, { ...publicEmployee(stored), firstName: 'Santiago' }), admin)
    assert.deepEqual(renamed.agenda, next.agenda)
    assert.deepEqual(renamed.history, next.history)
  }
})

test('el guardado de estado también incorpora luego de autorización sin exigir permisos de planificación', () => {
  const context = fixture(), added = { ...employee('new'), passwordHash: undefined, password: 'NuevaClave123' }
  const authorized = authorizeIncomingState({ ...context.state, employees: [...context.state.employees, added] }, context.state, personnel)
  const next = normalizeStateForSave(authorized, context.state)
  assertIncorporated(next, context.state, context)
  const repeated = normalizeStateForSave(next, next)
  assert.deepEqual(repeated.agenda, next.agenda)
  assert.deepEqual(repeated.history, next.history)
})

test('un conflicto futuro rechaza el alta completa en vez de asignar al técnico en dos equipos', () => {
  const context = fixture()
  const extra = { ...context.state.history.find(record => record.id === 'pending'), id: 'other', sourceTaskId: 'other-task', teamId: 'explicit-team', technicianIds: ['new'], technicians: ['NEW Prueba'] }
  context.state.history.push(extra)
  for (const plan of [context.state.agenda, context.state.agenda.weekly[context.day]]) plan.teams.push({ teamId: 'explicit-team', memberIds: ['new'], members: ['NEW Prueba'], tasks: [{ ...extra, taskId: extra.sourceTaskId, historyId: extra.id }] })
  const before = structuredClone(context.state)
  assert.throws(() => applyEmployeeOperation(context.state, operation(null, { ...employee('new'), passwordHash: undefined, password: 'NuevaClave123' }), admin), /servicios incompatibles/)
  assert.deepEqual(context.state, before)
})

test('el alta conserva avances e informes de Leonardo inactivo mientras lo retira de los equipos futuros', () => {
  const context = fixture(), leonardo = { ...employee('leo', 'tech', 'Inactivo'), firstName: 'Leonardo', lastName: 'Rivadero', name: 'Leonardo Rivadero' }
  context.state.employees.push(leonardo)
  const base = context.state.history.find(record => record.id === 'pending')
  const recorded = [
    { ...base, id: 'leonardo-advance', date: '2020-01-02', status: 'Avance registrado', technicalStatus: 'Avance registrado', technicalObservation: 'Informe original del avance' },
    { ...base, id: 'leonardo-report', date: '2020-01-03', status: 'Requiere revisión', technicalReportedAt: '2020-01-03T12:00:00.000Z', technicalObservation: 'Informe para reprogramar' },
    { ...base, id: 'leonardo-correction', time: '11:00', workCompletion: { corrections: [{ reason: 'Corrección conservada' }] } },
    { ...base, id: 'leonardo-task-only', time: '12:00' }
  ].map(record => ({ ...record, sourceTaskId: `${record.id}-task`, technicianIds: ['leo'], technicians: [leonardo.name] }))
  context.state.history.push(...recorded)
  for (const plan of [context.state.agenda, context.state.agenda.weekly[context.day]]) {
    plan.teams[0].memberIds.push('leo')
    plan.teams[0].members.push(leonardo.name)
    plan.teams[0].tasks.push({ ...recorded[2], taskId: recorded[2].sourceTaskId, historyId: recorded[2].id })
    plan.teams[0].tasks.push({ ...recorded[3], taskId: recorded[3].sourceTaskId, technicalObservation: 'Informe presente sólo en la tarjeta' })
  }
  for (const next of [
    applyEmployeeOperation(context.state, operation(null, { ...employee('new'), passwordHash: undefined, password: 'NuevaClave123' }), admin),
    normalizeStateForSave({ ...context.state, employees: [...context.state.employees, employee('new')] }, context.state)
  ]) {
    for (const record of recorded) assert.deepEqual(next.history.find(item => item.id === record.id), record)
    assert.equal(next.employees.find(item => item.id === 'leo').status, 'Inactivo')
    assert.equal(next.agenda.weekly[context.day].teams[0].memberIds.includes('leo'), false)
    assert.deepEqual(next.agenda.weekly[context.day].teams[0].tasks.find(item => item.historyId === 'leonardo-correction').technicianIds, ['leo'])
    assert.deepEqual(next.agenda.weekly[context.day].teams[0].tasks.find(item => item.taskId === recorded[3].sourceTaskId).technicianIds, ['leo'])
  }
})
