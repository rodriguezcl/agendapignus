const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { synchronizeAgendaHistoryRecord } = require('../api/_lib/history-record-operation.cjs')

test('cancelaciones actuales y anteriores no cuentan como pendientes', async () => {
  const { dashboardPendingGroups, historyStatusLabel } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  for (const status of ['Cancelado', 'Requiere revisión']) {
    const record = { status, technicalStatus: 'Cancelado', date: '2026-10-08', awaitingConfirmation: true, technicalObservation: 'Cliente ausente', technicalReportedById: 'tech', technicalReportedAt: '2026-10-08T12:00:00Z' }
    assert.deepEqual(dashboardPendingGroups([record], '2026-10-08'), { today: [], overdue: [], rescheduling: [], confirmation: [] })
    assert.equal(historyStatusLabel(record), 'Cancelado')
    assert.equal(record.technicalObservation, 'Cliente ausente')
  }
})

test('no oculta un servicio que administración reprogramó después', async () => {
  const { dashboardPendingGroups } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  const record = { status: 'Reprogramado', technicalStatus: 'Cancelado', scheduledDate: '2026-10-08' }
  assert.deepEqual(dashboardPendingGroups([record], '2026-10-08').today, [record])
})

test('ambos servidores cierran la cancelación y sincronizan la agenda', () => {
  for (const file of ['api/index.js', 'server.cjs']) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(source.includes("status: ['Completado', 'Avance registrado', 'Cancelado'].includes(type) ? type : 'Requiere revisión'"))
    assert.ok(source.includes("technicianRequest: ['Completado', 'Avance registrado', 'Cancelado'].includes(type) ? '' : type"))
    assert.ok(source.includes("record.serviceJourney || type === 'Cancelado'"))
  }
  const record = { id: 'history-1' }
  const agenda = synchronizeAgendaHistoryRecord([{ historyId: record.id, status: 'Pendiente' }], record, { ...record, status: 'Cancelado' })
  assert.equal(agenda[0].status, 'Cancelado')
})
