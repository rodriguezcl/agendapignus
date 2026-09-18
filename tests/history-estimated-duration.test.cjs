const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { synchronizeAgendaHistoryRecord } = require('../api/_lib/history-record-operation.cjs')

test('editing estimated duration synchronizes daily and weekly projections without altering other services', () => {
  const record = { id: 'h1', sourceTaskId: 't1', estimatedMinutes: 90, status: 'Requiere revisión' }
  const task = { taskId: 't1', historyId: 'h1', estimatedMinutes: 90 }
  const other = { taskId: 't2', estimatedMinutes: 60 }
  const agenda = { teams: [{ tasks: [task, other] }], weekly: { '2026-09-21': { teams: [{ tasks: [task] }] } } }
  const next = synchronizeAgendaHistoryRecord(agenda, record, { ...record, estimatedMinutes: 120, estimatedMinutesCustomized: true })
  assert.equal(next.teams[0].tasks[0].estimatedMinutes, 120)
  assert.equal(next.weekly['2026-09-21'].teams[0].tasks[0].estimatedMinutesCustomized, true)
  assert.equal(next.teams[0].tasks[1].estimatedMinutes, 60)
  assert.equal(task.estimatedMinutes, 90)
})

test('availability uses the saved edited duration', async () => {
  const { availableRescheduleTeams } = await import('../src/domain/agenda/reschedule-availability.mjs')
  const teams = [{ teamId: '1', memberIds: ['a'], tasks: [{ service: 'Otro', time: '15:30', estimatedMinutes: 60 }] }]
  assert.equal(availableRescheduleTeams(teams, { estimatedMinutes: 90 }, '2026-09-21', '14:00').length, 1)
  assert.equal(availableRescheduleTeams(teams, { estimatedMinutes: 120 }, '2026-09-21', '14:00').length, 0)
})

test('history displays duration and exposes the shared duration editor while controls remain fixed', () => {
  const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  const detail = source.slice(source.indexOf('function HistoryManagementDetail'), source.indexOf('function HistoryDetail('))
  assert.match(detail, /<b>Tiempo estimado<\/b>/)
  assert.match(detail, /ServiceEstimatedDurationField value=\{draft.estimatedMinutes\}/)
  assert.match(detail, /estimatedMinutesCustomized: true/)
  assert.match(detail, /record.vehicleControl \? <label>Tiempo estimado<input value="15 minutos" readOnly/)
})
