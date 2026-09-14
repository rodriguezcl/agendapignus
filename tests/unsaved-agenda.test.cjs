const test = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../src/domain/agenda/unsaved-agenda.mjs')

test('la agenda vacía no activa el aviso de descarte aunque tenga equipos asignados', async () => {
  const { agendaHasUnsavedServices } = await load()
  const teams = [{ teamId: 'team-1', memberIds: ['e1'], members: ['Santos Díaz'], tasks: [{ taskId: 'blank', time: '', serviceId: '', service: '', client: '', detail: '' }] }]
  assert.equal(agendaHasUnsavedServices({ teams, history: [], date: '2026-09-14' }), false)
})

test('distingue un servicio ya guardado de uno nuevo o editado', async () => {
  const { agendaHasUnsavedServices } = await load()
  const task = { taskId: 'task-1', historyId: 'history-1', time: '08:45', serviceId: 'service-1', service: 'Instalación', customerId: 'customer-1', client: 'CLI-1 Cliente', address: 'Dirección', phone: '123', detail: 'Detalle' }
  const team = { teamId: 'team-1', memberIds: ['e1'], members: ['Santos Díaz'], tasks: [task] }
  const record = { id: 'history-1', sourceTaskId: 'task-1', date: '2026-09-14', time: '08:45', serviceId: 'service-1', service: 'Instalación', customerId: 'customer-1', client: 'CLI-1 Cliente', address: 'Dirección', phone: '123', detail: 'Detalle', teamId: 'team-1', team: 'Equipo 1', technicianIds: ['e1'] }

  assert.equal(agendaHasUnsavedServices({ teams: [team], history: [record], date: '2026-09-14' }), false)
  assert.equal(agendaHasUnsavedServices({ teams: [{ ...team, tasks: [{ ...task, detail: 'Cambio sin guardar' }] }], history: [record], date: '2026-09-14' }), true)
  assert.equal(agendaHasUnsavedServices({ teams: [{ ...team, tasks: [...team.tasks, { taskId: 'task-2', serviceId: 'service-1', client: 'Nuevo' }] }], history: [record], date: '2026-09-14' }), true)
})
