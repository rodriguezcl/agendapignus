const test = require('node:test')
const assert = require('node:assert/strict')
const { assertVehicleControlSchedule, validateVehicleControlSchedules } = require('../api/_lib/vehicle-control-schedule-policy.cjs')
const weekly = { _vehicleControls: { paused: true } }
const control = { id: 'vehicle-control-2026-11-27-ka', vehicleControl: true, date: '2026-11-27', time: '15:45', estimatedMinutes: 15, status: 'Pendiente' }

test('la pausa impide nuevas altas, movimientos e informes desde Historial o agenda', () => {
  assert.throws(() => assertVehicleControlSchedule(control, undefined, weekly), /pausados/)
  assert.throws(() => assertVehicleControlSchedule({ ...control, teamId: 'other' }, control, weekly), /pausados/)
  for (const patch of [{ status: 'Completado' }, { startedAt: '2026-11-27T18:45:00Z' }, { technicalStatus: 'Completado' }]) {
    assert.throws(() => assertVehicleControlSchedule({ ...control, ...patch }, control, weekly), /pausados/)
  }
  const before = { history: [control], agenda: { weekly } }
  const after = structuredClone(before)
  after.history[0].status = 'Completado'
  assert.throws(() => validateVehicleControlSchedules(after, before), /pausados/)
})

test('pausar no exige eliminar controles ni impide conservar o corregir informes históricos', () => {
  assert.doesNotThrow(() => assertVehicleControlSchedule(control, control, weekly))
  assert.doesNotThrow(() => assertVehicleControlSchedule({ ...control, detail: 'Nota de planificación' }, control, weekly))
  const completed = { ...control, status: 'Completado', technicalStatus: 'Completado', technicalNotes: 'Informe original' }
  assert.doesNotThrow(() => assertVehicleControlSchedule({ ...completed, administrativeNotes: 'Corrección' }, completed, weekly))
  assert.doesNotThrow(() => assertVehicleControlSchedule(control, undefined, { _vehicleControls: { paused: false } }))
})

test('las notificaciones omiten controles pausados pero siguen avisando servicios ordinarios', async () => {
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const records = [control, { ...control, id: 'normal', vehicleControl: false, client: 'Cliente' }]
  const options = { history: records, isAdministrator: true, today: '2026-11-30', now: Date.parse('2026-11-30T12:00:00Z') }
  const active = selectDashboardNotifications(options)
  const paused = selectDashboardNotifications({ ...options, weekly })
  assert.ok(active.find(notice => notice.id === 'pending:overdue').soundKeys.includes(`pending:overdue:${control.id}`))
  assert.deepEqual(paused.find(notice => notice.id === 'pending:overdue').soundKeys, ['pending:overdue:normal'])
})
