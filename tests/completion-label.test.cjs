const test = require('node:test')
const assert = require('node:assert/strict')

test('completion reports delay without claiming team availability', async () => {
  const { completionLabel } = await import('../src/domain/agenda/completion-label.mjs')
  const task = { date: '2026-09-17', time: '08:30', estimatedMinutes: 60, status: 'Completado' }
  assert.equal(completionLabel({ ...task, completedAt: '2026-09-17T13:54:00Z' }), 'Finalizó con demora a las 10:54')
  assert.equal(completionLabel({ ...task, completedAt: '2026-09-17T12:30:00Z' }), 'Finalizó a las 09:30')
  assert.equal(completionLabel({ ...task, completedAt: '2026-09-17T12:00:00Z' }), 'Finalizó a las 09:00')
  assert.equal(completionLabel(task), '')
})
