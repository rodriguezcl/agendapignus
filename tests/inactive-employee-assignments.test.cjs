const test = require('node:test')
const assert = require('node:assert/strict')
const { removeInactiveAssignments } = require('../api/_lib/inactive-employee-assignments.cjs')
const employee = { id: 'leo', name: 'Leonardo Rivadero', firstName: 'Leonardo', lastName: 'Rivadero', status: 'Inactivo', roleId: 'tech', email: 'leo@example.test' }
const pair = { technicianIds: ['leo', 'santos'], technicians: ['Leonardo Rivadero', 'Santos'] }
const pending = { id: 'pending', ...pair, date: '2026-11-26', status: 'Pendiente', detail: 'Conservar detalle de agenda' }
const completed = { ...pending, id: 'closed', status: 'Completado' }
const team = { teamId: 'team', memberIds: pair.technicianIds, members: pair.technicians, tasks: [{ ...pending, historyId: 'pending' }, { ...completed, historyId: 'closed' }] }
const fixture = () => ({ employees: [employee], history: [pending, completed], agenda: { date: '2026-11-26', teams: [team], weekly: { '2026-11-26': { teams: [team] }, '2026-11-20': { teams: [team] }, _monthlyTeams: { '2026-11': { teams: [team] } } } } })
test('retira solo al inactivo de servicios abiertos y planificación; conserva informes e historial cerrado', () => {
  const state = fixture(), before = structuredClone(state)
  const next = removeInactiveAssignments(state, '2026-11-25')
  assert.deepEqual(next.history[0].technicianIds, ['santos'])
  assert.equal(next.history[0].detail, pending.detail)
  assert.deepEqual(next.history[1], completed)
  for (const t of [next.agenda.teams[0], next.agenda.weekly['2026-11-26'].teams[0], next.agenda.weekly._monthlyTeams['2026-11'].teams[0]]) {
    assert.deepEqual(t.memberIds, ['santos'])
    assert.deepEqual(t.tasks[0].technicians, ['Santos'])
    assert.deepEqual(t.tasks[1], team.tasks[1])
  }
  assert.deepEqual(next.agenda.weekly['2026-11-20'].teams[0].memberIds, ['leo', 'santos'])
  assert.deepEqual(state, before)
  assert.deepEqual(removeInactiveAssignments(next, '2026-11-25'), next)
})
test('un servicio individual queda sin asignar; no se elimina ni se completa', () => {
  const state = fixture()
  state.history = [{ id: 'solo', status: 'Pendiente', technicianIds: ['leo'], technicians: ['Leonardo Rivadero'] }]
  const record = removeInactiveAssignments(state).history[0]
  assert.deepEqual(record.technicianIds, [])
  assert.equal(record.status, 'Pendiente')
  assert.equal(record.id, 'solo')
})
test('el comando de empleado limpia también asignaciones de una cuenta ya inactiva', () => {
  const { applyEmployeeOperation } = require('../api/_lib/employee-operation.cjs')
  const state = { ...fixture(), roles: [{ id: 'tech', code: 'technician', name: 'Técnico' }] }
  const next = applyEmployeeOperation(state, [{ path: ['employees', { key: 'id', id: 'leo' }], before: employee, after: employee, existed: true, exists: true }], { roleCode: 'administrator' })
  assert.deepEqual(next.history[0].technicianIds, ['santos'])
  assert.deepEqual(next.history[1], completed)
})
test('una sesión ya abierta se invalida al desactivar al empleado', () => {
  const fs = require('node:fs'), vm = require('node:vm')
  const source = fs.readFileSync(require.resolve('../server.cjs'), 'utf8')
  const start = source.indexOf('function sessionUser(req) {')
  const end = source.indexOf('\n}', start) + 2
  const sessions = new Map([['token', { user: { id: 'leo' }, expiresAt: Date.now() + 60000 }]])
  const context = { sessions, parseCookies: () => ({ pignus_session: 'token' }), rows: () => [employee] }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  assert.equal(context.sessionUser({ headers: {} }), null)
  assert.equal(sessions.size, 0)
})
