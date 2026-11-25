const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleStateForUser, authorizeIncomingState } = require('../api/_lib/core.cjs')
const { assertTechnicalAction } = require('../api/_lib/endpoint-policy.cjs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const gate = require('../api/_lib/technician-agenda-gate.cjs')
const friday = '2099-01-09'
const paused = { _vehicleControls: { paused: true } }
const actor = keys => ({ id: 'tech', roleId: 'custom', roleCode: 'custom', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) } })
const control = { id: `vehicle-control-${friday}-car`, sourceTaskId: 'control-task', vehicleControl: true, vehicleControlScheduledFriday: friday, serviceId: 'vehicle-weekly-control', service: 'Control semanal de vehículo', technicianIds: ['tech'], technicians: ['Técnico'], teamId: 'team', date: friday, time: '15:45', estimatedMinutes: 15, status: 'Pendiente' }
function fixture(isPaused = true) {
 const task = { ...control, taskId: control.sourceTaskId, historyId: control.id }
 return { roles: [], employees: [], services: [], vehicles: [], customers: [], reviews: [], preferences: {}, history: [{ ...control }], agenda: { date: friday, teams: [], weekly: { _vehicleControls: { paused: isPaused }, [friday]: { teams: [{ teamId: 'team', memberIds: ['tech'], tasks: [task] }] } } } }
}

test('Flota puede pausar y reanudar sin permisos de planificación ni modificar el historial', () => {
 for (const user of [actor(['vehicles.view', 'vehicles.edit']), { id: 'fleet', roleCode: 'custom', permissions: { vehicles: true } }]) {
  const current = fixture(false)
  const incoming = structuredClone(visibleStateForUser(current, user))
  assert.equal(incoming.agenda.weekly._vehicleControls.paused, false)
  incoming.agenda.weekly._vehicleControls = { paused: true }
  const saved = authorizeIncomingState(incoming, current, user)
  assert.equal(saved.agenda.weekly._vehicleControls.paused, true)
  assert.deepEqual(saved.history, current.history)
  assert.deepEqual(saved.agenda.weekly[friday], current.agenda.weekly[friday])
  const resume = visibleStateForUser(saved, user)
  resume.agenda.weekly._vehicleControls = { paused: false }
  assert.equal(authorizeIncomingState(resume, saved, user).agenda.weekly._vehicleControls.paused, false)
 }
})

test('el permiso de agenda o lectura de Flota no autoriza pausar controles', () => {
 const current = fixture(false)
 for (const user of [actor(['weekly.view', 'planning.edit']), actor(['vehicles.view'])]) {
  const incoming = structuredClone(visibleStateForUser(current, user))
  incoming.agenda.weekly._vehicleControls = { paused: true }
  assert.throws(() => authorizeIncomingState(incoming, current, user), /vehicles.edit/)
 }
 const legacy = { id: 'planner', roleCode: 'custom', permissions: { weekly: true } }
 const incoming = structuredClone(visibleStateForUser(current, legacy))
 incoming.agenda.weekly._vehicleControls = { paused: true }
 assert.equal(authorizeIncomingState(incoming, current, legacy).agenda.weekly._vehicleControls.paused, false)
 const fleet = actor(['vehicles.view', 'vehicles.edit'])
 const malformed = visibleStateForUser(current, fleet)
 malformed.agenda.weekly._vehicleControls = { paused: 'true' }
 assert.throws(() => authorizeIncomingState(malformed, current, fleet), /inválida/)
})

test('pausar quita controles abiertos del bloqueo diario y la proyección técnica, conservando informes', () => {
 const legacy = { id: 'tech', roleCode: 'technician' }
 const granular = { ...actor(['technical.view', 'records.read', 'technical.history', 'scope.services.read.assigned', 'vehicle.controls.read']), roleCode: 'technician' }
 const old = { ...control, date: '2020-01-01' }
 const complete = { ...old, id: 'completed-control', status: 'Completado', technicalStatus: 'Completado', vehicleMileage: 12345 }
 const regular = { ...old, id: 'regular', date: '2020-01-02', vehicleControl: false, serviceId: 'service', service: 'Servicio' }
 const records = [old, complete, regular]
 assert.equal(gate.cutoff(records, legacy, '2020-01-03', {}), '2020-01-01')
 assert.equal(gate.cutoff(records, legacy, '2020-01-03', paused), '2020-01-02')
 for (const user of [legacy, granular]) {
  const state = fixture()
  state.history = records
  const visible = visibleStateForUser(state, user)
  assert.equal(visible.agenda.weekly._vehicleControls.paused, true)
  assert.ok(!visible.history.some(record => record.id === old.id))
  assert.ok(visible.history.some(record => record.id === 'completed-control'))
  assert.ok(visible.history.some(record => record.id === 'regular'))
  assert.deepEqual(state.history, records)
 }
})

test('reportes técnicos y arranque de controles abiertos se bloquean también con permisos legacy', () => {
 for (const user of [{ id: 'tech', roleCode: 'technician' }, { ...actor(['technical.view', 'technical.vehicleControl']), roleCode: 'technician' }]) {
  for (const type of ['Completado', 'start']) assert.throws(() => assertTechnicalAction(user, control, fixture(), type), { code: 'VEHICLE_CONTROLS_PAUSED' })
 }
 assert.doesNotThrow(() => assertTechnicalAction({ id: 'tech', roleCode: 'technician' }, { ...control, technicalStatus: 'Completado' }, fixture(), 'Completado'))
 assert.doesNotThrow(() => assertTechnicalAction({ id: 'tech', roleCode: 'technician' }, control, fixture(false), 'Completado'))
})

test('la pausa libera el horario y reanudar rechaza una superposición sin alterar los registros', () => {
 const current = fixture()
 const next = structuredClone(current)
 const service = { ...control, id: 'service', sourceTaskId: 'service-task', vehicleControl: false, vehicleControlScheduledFriday: undefined, serviceId: 'service', service: 'Servicio normal' }
 next.history.push(service)
 next.agenda.weekly[friday].teams[0].tasks.push({ ...service, taskId: 'service-task', historyId: 'service' })
 assert.doesNotThrow(() => validateChangedAgendaSchedules(next, current))
 assert.equal(next.history.length, 2)
 assert.equal(next.agenda.weekly[friday].teams[0].tasks.length, 2)
 const resume = structuredClone(next)
 resume.agenda.weekly._vehicleControls.paused = false
 assert.throws(() => validateChangedAgendaSchedules(resume, next), /conflicto de horarios/)
})

test('los usuarios de notificaciones reciben solo el indicador de pausa sin acceder a la agenda', () => {
 for (const user of [actor(['notifications.pendingServices', 'dashboard.view']), { id: 'viewer', roleCode: 'custom', permissions: { history: true } }]) {
  const result = visibleStateForUser(fixture(), user)
  assert.deepEqual(result.agenda, { weekly: { _vehicleControls: { paused: true } } })
 }
})

test('reanudar desde Flota realinea controles existentes tras feriado sin conceder edición de servicios', () => {
 const { normalizeStateForSave } = require('../api/_lib/core.cjs')
 const current = fixture()
 current.agenda.teams = structuredClone(current.agenda.weekly[friday].teams)
 current.agenda.weekly._holidayOverrides = { [friday]: { status: 'closed' } }
 const user = actor(['vehicles.view', 'vehicles.edit'])
 const incoming = structuredClone(visibleStateForUser(current, user))
 incoming.agenda.weekly._vehicleControls = { paused: false }
 const authorized = authorizeIncomingState(incoming, current, user)
 assert.deepEqual(authorized.history, current.history, 'La petición solo está autorizada a cambiar la pausa')
 const saved = normalizeStateForSave(authorized, current)
 assert.equal(saved.history[0].date, '2099-01-08')
 assert.equal(saved.history[0].time, '16:45')
 assert.equal(saved.history[0].estimatedMinutes, 15)
 assert.equal(saved.agenda.weekly[friday].teams[0].tasks.length, 0)
 assert.equal(saved.agenda.teams[0].tasks.length, 0)
 assert.equal(saved.agenda.weekly['2099-01-08'].teams[0].tasks[0].time, '16:45')
 assert.doesNotThrow(() => validateChangedAgendaSchedules(saved, current))
 assert.equal(current.history[0].date, friday, 'El estado anterior conserva sus datos para auditoría')
})

test('la realineación conserva controles históricos, iniciados e informados y las otras tareas', () => {
 const { resumeVehicleControls } = require('../api/_lib/vehicle-controls-resume.cjs')
 const current = fixture()
 current.agenda.date = '2099-01-08'
 current.agenda.teams = [{ teamId: 'team', memberIds: ['tech'], tasks: [{ taskId: 'ordinary', service: 'Otra tarea', time: '14:00' }] }]
 current.agenda.weekly._holidayOverrides = { [friday]: { status: 'closed' } }
 const protectedRecords = [
  { ...control, id: 'historic', date: '2020-01-03', technicalStatus: 'Completado', technicalObservation: 'Foto e informe anteriores' },
  { ...control, id: 'started', startedAt: '2099-01-09T18:45:00Z' },
  { ...control, id: 'old-pending', date: '2020-01-03' },
  { ...control, id: 'wrong-future', vehicleControlScheduledFriday: '2020-01-03' },
  { id: 'ordinary', date: friday, status: 'Pendiente', detail: 'Sin cambios' }
 ]
 current.history.push(...protectedRecords)
 const incoming = structuredClone(current)
 incoming.agenda.weekly._vehicleControls.paused = false
 const saved = resumeVehicleControls(incoming, current, '2099-01-01')
 assert.deepEqual(saved.history.slice(1), protectedRecords)
 assert.equal(saved.agenda.teams[0].tasks[0].taskId, 'ordinary')
 assert.equal(saved.agenda.teams[0].tasks[1].historyId, control.id)
 assert.equal(saved.agenda.teams[0].tasks[1].time, '16:45')
 assert.equal(saved.history.length, current.history.length)
 assert.deepEqual(incoming.history, current.history)
 for (const day of ['2099-01-08', '2099-01-07']) incoming.agenda.weekly._holidayOverrides[day] = { status: 'closed' }
 assert.throws(() => resumeVehicleControls(incoming, current, '2099-01-01'), /miércoles/)
 assert.equal(current.agenda.weekly._vehicleControls.paused, true)
})

test('el servidor local autoriza el toggle legacy y aplica la realineación antes de persistir', async () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
 const filename = path.resolve(__dirname, '../server.cjs')
 const nativeRequire = require('node:module').createRequire(filename)
 const source = fs.readFileSync(filename, 'utf8')
 const current = fixture()
 current.revision = 0
 current.agenda.weekly._holidayOverrides = { [friday]: { status: 'closed' } }
 let normalized
 const context = {
  require: name => name.endsWith('/tickets-http.cjs') ? { storeFor: () => ({ ensure: async () => {} }) } : nativeRequire(name),
  readState: () => current,
  ...require('../api/_lib/access-policy.cjs'),
  db: {}, currentStateRevision: () => 0,
  migrateLegacyEstimatedMinutes: state => { normalized = state; throw Object.assign(new Error('Normalización alcanzada'), { code: 'NORMALIZED' }) }
 }
 vm.createContext(context)
 for (const name of ['authorizedIncomingState', 'saveState']) {
  const start = source.indexOf(`${name === 'saveState' ? 'async ' : ''}function ${name}(`)
  const end = source.indexOf('\n}', start) + 2
  assert.ok(start >= 0 && end > start)
  vm.runInContext(source.slice(start, end), context, { filename })
 }
 const user = { id: 'fleet', roleCode: 'custom', permissions: { vehicles: true } }
 const incoming = structuredClone(visibleStateForUser(current, user))
 incoming.agenda.weekly._vehicleControls.paused = false
 const denied = context.authorizedIncomingState(incoming, { id: 'viewer', roleCode: 'custom', permissions: {} })
 assert.equal(denied.agenda.weekly._vehicleControls.paused, true)
 await assert.rejects(() => context.saveState(incoming, user), { code: 'NORMALIZED' })
 assert.equal(normalized.history[0].date, '2099-01-08')
 assert.equal(normalized.history[0].time, '16:45')
 assert.equal(normalized.agenda.weekly._vehicleControls.paused, false)
 assert.equal(current.history[0].date, friday)
})
