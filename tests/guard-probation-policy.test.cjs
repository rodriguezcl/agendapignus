const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeEmployeeEmploymentDates } = require('../api/_lib/employee-employment-date.cjs')
const { applyEmployeeOperation } = require('../api/_lib/employee-operation.cjs')
const { reconcileNewTechnicians } = require('../api/_lib/onboard-technicians.cjs')
const { validateGuardAssignments, assertGuardServiceAssignment, isGuardTeam } = require('../api/_lib/guard-assignment-policy.cjs')
const { guardEligibleFrom } = require('../api/_lib/guard-eligibility.cjs')
const { guardForDate } = require('../api/_lib/annual-guard-rotation.cjs')
const roles = [{ id: 'tech', name: 'Técnico', code: 'technician' }, { id: 'user', name: 'Usuario', code: 'user' }]
const employee = { id: 'new', roleId: 'tech', role: 'Técnico', firstName: 'Santiago', lastName: 'Castillo', name: 'Santiago Castillo', email: 'new@example.test', status: 'Activo', employmentStartDate: '2026-11-24' }
const senior = { ...employee, id: 'senior', firstName: 'Técnico', lastName: 'Anterior', name: 'Técnico Anterior', email: 'senior@example.test', employmentStartDate: '2020-01-01' }
const base = () => ({ roles, employees: [{ ...employee }, { ...senior }], services: [], customers: [], vehicles: [], reviews: [], preferences: {}, history: [], agenda: { date: '', teams: [], weekly: {} } })
const today = '2026-11-25'

test('la fecha se establece en nuevas cuentas incluso inactivas y no reinicia la antigüedad legacy', () => {
  const { employmentStartDate, ...withoutDate } = employee
  for (const status of ['Activo', 'Inactivo']) {
    const result = normalizeEmployeeEmploymentDates({ roles, employees: [{ ...withoutDate, status }] }, { roles, employees: [] }, today)
    assert.equal(result.employees[0].employmentStartDate, today)
    const active = normalizeEmployeeEmploymentDates({ ...result, employees: [{ ...result.employees[0], status: 'Activo' }] }, result, '2026-11-26')
    assert.equal(active.employees[0].employmentStartDate, today)
    assert.equal(guardEligibleFrom(active.employees[0]), '2027-01-24')
  }
  const old = { roles, employees: [{ ...withoutDate, status: 'Inactivo' }] }
  assert.equal(normalizeEmployeeEmploymentDates({ roles, employees: [withoutDate] }, old, today).employees[0].employmentStartDate, undefined)
  const otherRole = { roles, employees: [{ ...withoutDate, roleId: 'user', role: 'Usuario' }] }
  assert.equal(normalizeEmployeeEmploymentDates({ roles, employees: [withoutDate] }, otherRole, today).employees[0].employmentStartDate, today)
})

test('fecha inválida y borrado de antigüedad conocida se rechazan; el metadato del cliente no habilita guardias', () => {
  for (const employmentStartDate of ['2026-02-30', '25/11/2026', 20261125, '', null]) {
    assert.throws(() => normalizeEmployeeEmploymentDates({ roles, employees: [{ ...employee, employmentStartDate }] }, base(), today), { code: 'EMPLOYMENT_START_DATE_INVALID' })
  }
  const next = normalizeEmployeeEmploymentDates({ roles, employees: [{ ...employee, guardEligibleFrom: '2000-01-01' }] }, base(), today)
  assert.equal(Object.hasOwn(next.employees[0], 'guardEligibleFrom'), false)
  assert.equal(guardEligibleFrom(next.employees[0]), '2027-01-23')
})

test('la guarda semanal bloquea sábado temprano y el viernes día59 aunque el sábado sea día60', () => {
  const state = base()
  const team = { teamId: 'ordinary', label: 'Equipo 1', memberIds: ['new'], members: [employee.name], tasks: [{ serviceId: 'alarm', time: '16:30' }] }
  for (const date of ['2027-01-16', '2027-01-22']) {
    state.agenda.weekly = { [date]: { teams: [team] } }
    assert.equal(isGuardTeam(date, team), true)
    assert.throws(() => validateGuardAssignments(state, null, today), { code: 'GUARD_PROBATION' })
  }
  state.agenda.weekly = { '2027-01-23': { teams: [team] } }
  assert.doesNotThrow(() => validateGuardAssignments(state, null, today))
  state.agenda.weekly = { '2026-11-26': { teams: [team] } }
  assert.doesNotThrow(() => validateGuardAssignments(state, null, today), 'Las tareas ordinarias entre semana siguen disponibles')
  state.agenda.weekly = { '2027-01-22': { teams: [{ ...team, tasks: [{ serviceId: 'vehicle-weekly-control', time: '16:45' }] }] } }
  assert.doesNotThrow(() => validateGuardAssignments(state, null, today), 'Un control no es una guardia adelantada')
})

test('las operaciones individuales de historial usan la misma fecha real y preservan informes históricos', () => {
  const state = base()
  const record = { id: 'work', date: '2027-01-22', time: '16:30', serviceId: 'alarm', status: 'Pendiente', technicianIds: ['new'], technicians: [employee.name] }
  assert.throws(() => assertGuardServiceAssignment(record, null, state, today), { code: 'GUARD_PROBATION' })
  assert.doesNotThrow(() => assertGuardServiceAssignment({ ...record, date: '2027-01-23', time: '09:00' }, null, state, today))
  assert.doesNotThrow(() => assertGuardServiceAssignment({ ...record, date: '2026-11-21', technicalObservation: 'Informe histórico' }, null, state, today))
  assert.doesNotThrow(() => assertGuardServiceAssignment({ ...record, serviceId: 'vehicle-weekly-control' }, null, state, today))
})

test('la configuración anual no acepta una habilitación adulterada o ausente que adelante la guardia', () => {
  const state = base()
  for (const guardEligibleFrom of [undefined, '2000-01-01']) {
    state.agenda.weekly._annualGuards = { 2026: { startDate: '2026-11-28', effectiveFrom: '2026-11-28', rotation: [{ technicianId: 'new', name: employee.name, guardEligibleFrom }] } }
    assert.throws(() => validateGuardAssignments(state, null, today), { code: 'GUARD_PROBATION' })
  }
  state.agenda.weekly._annualGuards[2026].rotation[0].guardEligibleFrom = '2027-01-23'
  assert.doesNotThrow(() => validateGuardAssignments(state, null, today))
  delete state.employees[0].employmentStartDate
  delete state.agenda.weekly._annualGuards[2026].rotation[0].guardEligibleFrom
  assert.doesNotThrow(() => validateGuardAssignments(state, null, today), 'El personal legacy sin fecha mantiene sus guardias')
})

test('corregir ingreso versiona la espera y libera guardias futuras heredadas sin borrar visitas', () => {
  const current = base()
  current.employees = [{ ...employee, employmentStartDate: '2020-01-01' }]
  const record = { id: 'future', sourceTaskId: 'future-task', date: '2026-11-28', teamId: 'guard', status: 'Pendiente', technicianIds: ['new'], technicians: [employee.name] }
  current.history = [record, { ...record, id: 'old', date: '2026-11-21', status: 'Completado', technicalObservation: 'Informe original' }]
  current.agenda.weekly = { _annualGuards: { 2026: { startDate: '2026-01-03', rotation: [{ technicianId: 'new', name: employee.name }] } }, [record.date]: { teams: [{ teamId: 'guard', memberIds: ['new'], members: [employee.name], tasks: [{ ...record, taskId: record.sourceTaskId, historyId: record.id }] }] } }
  const next = reconcileNewTechnicians({ ...current, employees: [{ ...current.employees[0], employmentStartDate: today }] }, current, today)
  assert.deepEqual(next.history[0].technicianIds, [])
  assert.deepEqual(next.history[1], current.history[1])
  assert.equal(next.history[0].id, record.id)
  assert.equal(next.history[0].status, 'Pendiente')
  assert.deepEqual(guardForDate('2026-11-21', next.agenda.weekly._annualGuards[2026]), guardForDate('2026-11-21', current.agenda.weekly._annualGuards[2026]))
  assert.equal(guardForDate('2026-11-28', next.agenda.weekly._annualGuards[2026]), null)
  assert.doesNotThrow(() => validateGuardAssignments(next, current, today))
  assert.deepEqual(reconcileNewTechnicians(next, current, today), next, 'Reintentar la misma corrección no duplica versiones ni auditoría')
})

test('corregir fecha requiere editar colaboradores; el permiso de estado no basta', () => {
  const state = base(), before = state.employees[0]
  const operation = [{ path: ['employees', { key: 'id', id: before.id }], before, after: { ...before, employmentStartDate: '2026-11-25' }, existed: true, exists: true }]
  const user = { roleCode: 'custom', permissions: { __catalogV2: true, 'employees.view': true, 'employees.status': true } }
  assert.throws(() => applyEmployeeOperation(state, operation, user), { permission: 'employees.edit' })
  assert.doesNotThrow(() => applyEmployeeOperation(state, operation, { ...user, permissions: { ...user.permissions, 'employees.edit': true } }))
})

test('alta inactiva y posterior activación por el comando no eluden la espera', () => {
  const current = base()
  current.employees = [senior]
  const { employmentStartDate, ...withoutDate } = employee
  const user = { roleCode: 'administrator' }
  const create = { ...withoutDate, status: 'Inactivo', password: 'ClaveSegura123' }
  const created = applyEmployeeOperation(current, [{ path: ['employees', { key: 'id', id: 'new' }], before: null, after: create, existed: false, exists: true }], user)
  const saved = created.employees.find(item => item.id === 'new')
  assert.ok(saved.employmentStartDate)
  const { passwordHash, ...publicSaved } = saved
  const active = applyEmployeeOperation(created, [{ path: ['employees', { key: 'id', id: 'new' }], before: publicSaved, after: { ...publicSaved, status: 'Activo' }, existed: true, exists: true }], user)
  assert.equal(active.employees.find(item => item.id === 'new').employmentStartDate, saved.employmentStartDate)
  const year = saved.employmentStartDate.slice(0, 4)
  const config = active.agenda.weekly._annualGuards[year]
  assert.equal(config.rotation.find(item => item.technicianId === 'new').guardEligibleFrom, guardEligibleFrom(saved))
})

test('ambos servidores rechazan una reasignación de Historial a guardia antes de procesar el cambio', () => {
  const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module')
  for (const filename of ['../api/index.js', '../server.cjs']) {
    const entry = require.resolve(filename), source = fs.readFileSync(entry, 'utf8')
    const start = source.indexOf('function managedHistoryRecord('), end = source.indexOf('\n}', start) + 2
    const context = { require: createRequire(entry), endpointPolicy: { restoreServiceProposal: (current, proposed) => proposed } }
    vm.createContext(context)
    vm.runInContext(source.slice(start, end), context)
    const state = base()
    state.employees = [{ ...employee, employmentStartDate: '2099-01-01' }]
    const current = { id: 'work', date: '2099-01-01', time: '10:00', status: 'Pendiente', serviceId: 'alarm', technicianIds: ['new'] }
    for (const proposal of [{ ...current, date: '2099-01-03' }, { ...current, date: '2099-01-02', time: '16:30' }]) {
      assert.throws(() => context.managedHistoryRecord(current, proposal, {}, '2099-01-01T12:00:00Z', state), error => error.code === 'GUARD_PROBATION')
    }
  }
})

test('la espera conserva informes presentes sólo en la tarjeta o en su historial enlazado por sourceTaskId', () => {
  for (const source of ['history', 'task']) {
    const state = base()
    const record = { id: 'reported', sourceTaskId: 'reported-task', date: '2026-11-28', time: '09:00', teamId: 'guard', status: 'Pendiente', technicianIds: ['new'], technicians: [employee.name], ...(source === 'history' ? { technicalObservation: 'Informe original' } : {}) }
    const task = { taskId: 'reported-task', serviceId: 'alarm', time: '09:00', status: 'Pendiente', technicianIds: ['new'], technicians: [employee.name], ...(source === 'task' ? { technicalObservation: 'Informe original' } : {}) }
    state.history = [record]
    state.agenda.weekly[record.date] = { teams: [{ teamId: 'guard', memberIds: ['new'], members: [employee.name], tasks: [task] }] }
    const before = structuredClone(state)
    assert.doesNotThrow(() => validateGuardAssignments(state, null, today))
    assert.doesNotThrow(() => assertGuardServiceAssignment(record, null, state, today))
    assert.deepEqual(state, before)
    state.agenda.weekly[record.date].teams[0].tasks.push({ taskId: 'new-visit', serviceId: 'alarm', time: '10:00', status: 'Pendiente' })
    assert.throws(() => validateGuardAssignments(state, null, today), { code: 'GUARD_PROBATION' }, 'Conservar un informe no habilita una guardia nueva del mismo equipo')
  }
})

test('corregir ingreso el sábado conserva la guardia ya informada sin habilitar pendientes ni otra asignación anual', () => {
  const saturday = '2026-11-28'
  for (const source of ['history', 'task']) {
    const current = base()
    current.employees[0].employmentStartDate = '2020-01-01'
    const record = { id: 'reported', sourceTaskId: 'reported-task', date: saturday, time: '09:00', teamId: 'guard', status: 'Pendiente', technicianIds: ['new'], technicians: [employee.name], ...(source === 'history' ? { technicalObservation: 'Informe original' } : {}) }
    const task = { taskId: 'reported-task', serviceId: 'alarm', time: '09:00', status: 'Pendiente', ...(source === 'task' ? { technicalObservation: 'Informe original' } : {}) }
    current.history = [record]
    current.agenda.weekly = {
      _annualGuards: { 2026: { startDate: '2026-01-03', rotation: [{ technicianId: 'new', name: employee.name }] } },
      [saturday]: { teams: [{ teamId: 'guard', memberIds: ['new'], members: [employee.name], tasks: [task] }] },
    }
    const next = reconcileNewTechnicians({ ...current, employees: [{ ...current.employees[0], employmentStartDate: today }, current.employees[1]] }, current, saturday)
    assert.deepEqual(next.history, current.history)
    assert.doesNotThrow(() => validateGuardAssignments(next, current, saturday))
    assert.equal(guardForDate('2026-12-05', next.agenda.weekly._annualGuards[2026]), null)
    assert.throws(() => validateGuardAssignments(next, null, saturday), { code: 'GUARD_PROBATION' }, 'Un informe sin asignación anual anterior no autoriza una nueva guardia')
    const pending = structuredClone(next)
    delete pending.history[0].technicalObservation
    delete pending.agenda.weekly[saturday].teams[0].tasks[0].technicalObservation
    assert.throws(() => validateGuardAssignments(pending, current, saturday), { code: 'GUARD_PROBATION' }, 'La guardia pendiente de hoy mantiene la restricción')
  }
})
