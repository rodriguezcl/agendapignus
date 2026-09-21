const test = require('node:test')
const assert = require('node:assert/strict')

test('preview omits unconfirmed services and sorts confirmed services without mutating planning', async () => {
  const { agendaPreviewTasks } = await import('../src/domain/agenda/preview-tasks.mjs')
  const tasks = [{ time: '14:00', awaitingConfirmation: true }, { time: '13:00' }, { time: '08:45' }]
  const original = structuredClone(tasks)
  assert.deepEqual(agendaPreviewTasks(tasks).map(task => task.time), ['08:45', '13:00'])
  assert.deepEqual(tasks, original)
  tasks[0].awaitingConfirmation = false
  assert.deepEqual(agendaPreviewTasks(tasks).map(task => task.time), ['08:45', '13:00', '14:00'])
})

test('empty confirmation-only teams have no preview tasks; missing times go last', async () => {
  const { agendaPreviewTasks } = await import('../src/domain/agenda/preview-tasks.mjs')
  assert.deepEqual(agendaPreviewTasks([{ awaitingConfirmation: true }]), [])
  assert.deepEqual(agendaPreviewTasks(), [])
  const missing = { id: 'missing' }
  const scheduled = { scheduledTime: '09:00' }
  const later = { time: '13:00' }
  assert.deepEqual(agendaPreviewTasks([missing, later, scheduled]), [scheduled, later, missing])
})
