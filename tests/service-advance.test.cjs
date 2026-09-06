const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  argentinaDateTime,
  requestServiceAdvance,
  resolveServiceAdvance,
  synchronizeAgendaAdvance
} = require('../api/_lib/service-advance.cjs')

const technician = { id: 'tech-1', name: 'Técnico Uno', roleCode: 'technician' }
const administrator = { id: 'admin-1', name: 'Administración', roleCode: 'administrator' }
const requestTime = Date.parse('2026-09-07T14:00:00.000Z') // 11:00 en Argentina
const record = {
  id: 'history-1', sourceTaskId: 'task-1', date: '2026-09-07', time: '13:00',
  service: 'Mantenimiento', client: 'Cliente', status: 'Pendiente', technicianIds: ['tech-1']
}

test('el técnico asignado solicita adelantar un servicio futuro del mismo día', () => {
  const next = requestServiceAdvance(record, technician, requestTime)

  assert.equal(next.advanceRequest.status, 'pending')
  assert.equal(next.advanceRequest.requestedById, technician.id)
  assert.equal(next.advanceRequest.scheduledTime, '13:00')
  assert.equal(record.advanceRequest, undefined)
  assert.equal(requestServiceAdvance(next, technician, requestTime), next)
})

test('impide solicitar adelantos fuera de la regla operativa', () => {
  assert.throws(() => requestServiceAdvance({ ...record, technicianIds: ['otro'] }, technician, requestTime), /no está asignado/)
  assert.throws(() => requestServiceAdvance({ ...record, date: '2026-09-08' }, technician, requestTime), /programados para hoy/)
  assert.throws(() => requestServiceAdvance({ ...record, time: '10:30' }, technician, requestTime), /ya se encuentra habilitado/)
  assert.throws(() => requestServiceAdvance({ ...record, vehicleControl: true }, technician, requestTime), /controles vehiculares/)
  assert.throws(() => requestServiceAdvance({ ...record, status: 'Completado' }, technician, requestTime), /ya fue informado/)
})

test('la aprobación registra la hora efectiva y la denegación conserva la planificación', () => {
  const pending = requestServiceAdvance(record, technician, requestTime)
  const approvedAt = Date.parse('2026-09-07T14:15:00.000Z') // 11:15 en Argentina
  const approved = resolveServiceAdvance(pending, administrator, 'approved', approvedAt)

  assert.deepEqual(argentinaDateTime(approvedAt), { date: '2026-09-07', time: '11:15' })
  assert.equal(approved.originalScheduledTime, '13:00')
  assert.equal(approved.time, '11:15')
  assert.equal(approved.scheduledTime, '11:15')
  assert.equal(approved.advanceRequest.status, 'approved')
  assert.equal(approved.advanceRequest.resolvedById, administrator.id)

  const denied = resolveServiceAdvance(pending, administrator, 'denied', approvedAt)
  assert.equal(denied.time, '13:00')
  assert.equal(denied.advanceRequest.status, 'denied')
  assert.throws(() => resolveServiceAdvance(denied, administrator, 'approved', approvedAt), /ya fue resuelta/)
  assert.throws(
    () => resolveServiceAdvance(pending, administrator, 'approved', Date.parse('2026-09-07T16:01:00.000Z')),
    /horario original ya llegó/
  )
})

test('sincroniza la aprobación en Agenda del día y Agenda semanal', () => {
  const pending = requestServiceAdvance(record, technician, requestTime)
  const approved = resolveServiceAdvance(pending, administrator, 'approved', Date.parse('2026-09-07T14:15:00.000Z'))
  const agenda = {
    teams: [{ teamId: 'daily', tasks: [{ taskId: 'task-1', historyId: 'history-1', time: '13:00' }] }],
    weekly: {
      '2026-09-07': { teams: [{ teamId: 'weekly', tasks: [{ taskId: 'task-1', historyId: 'history-1', time: '13:00' }] }] },
      _metadata: { untouched: true }
    }
  }
  const synchronized = synchronizeAgendaAdvance(agenda, approved)

  assert.equal(synchronized.teams[0].tasks[0].time, '11:15')
  assert.equal(synchronized.weekly['2026-09-07'].teams[0].tasks[0].time, '11:15')
  assert.equal(synchronized.weekly['2026-09-07'].teams[0].tasks[0].originalScheduledTime, '13:00')
  assert.deepEqual(synchronized.weekly._metadata, agenda.weekly._metadata)
})

test('la interfaz ofrece el flujo administrativo y alinea Formulario en móviles', () => {
  const root = path.resolve(__dirname, '..')
  const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.join(root, 'src/ui-polish.css'), 'utf8')
  const api = fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')

  assert.match(app, /Adelantar servicios/)
  assert.match(app, /Confirmar solicitud/)
  assert.match(app, /Aprobar adelanto/)
  assert.match(app, /Denegar/)
  assert.match(api, /\/technician\/advance-request/)
  assert.match(api, /\/admin\/advance-request\/approve/)
  assert.match(styles, /\.service-extra-form select \{[\s\S]*?width: 100% !important;/)
  assert.match(styles, /\.weekly-extra-fields \.service-extra-form select,[\s\S]*?min-height: 44px;/)
})
