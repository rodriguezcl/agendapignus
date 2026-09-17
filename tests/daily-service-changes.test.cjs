const { test } = require('node:test')
const assert = require('node:assert/strict')

test('discarding an existing edit restores all saved values without deleting its identity', async () => {
  const { restoreSavedService, serviceHasChanges } = await import('../src/domain/agenda/service-changes.mjs')
  const saved = { id: 'work-1', time: '14:00', client: 'Cliente', amount: '100', internalChecklist: [{ id: 'c1', text: 'Equipo', completed: false }] }
  const task = { taskId: 'task-1', historyId: 'work-1', ...saved, amount: '200', detail: 'nuevo', newCustomer: true }
  const restored = restoreSavedService(task, saved)
  assert.equal(restored.taskId, 'task-1')
  assert.equal(restored.historyId, 'work-1')
  assert.equal(restored.amount, '100')
  assert.equal(restored.detail, '')
  assert.equal(restored.newCustomer, false)
  assert.equal(serviceHasChanges(restored, saved), false)
  restored.internalChecklist[0].completed = true
  assert.equal(saved.internalChecklist[0].completed, false)
})

test('every editable field makes a saved service dirty, reverting or saving clears it', async () => {
  const { serviceHasChanges, serviceEditableFields } = await import('../src/domain/agenda/service-changes.mjs')
  const saved = Object.fromEntries(serviceEditableFields.map(key => [key, 'original']))
  assert.equal(serviceHasChanges(saved, saved), false)
  for (const key of serviceEditableFields) {
    const edited = { ...saved, [key]: 'changed' }
    assert.equal(serviceHasChanges(edited, saved), true, key)
    assert.equal(serviceHasChanges(edited, edited), false, key)
  }
  assert.equal(serviceHasChanges({ ...saved, internalChecklist: [{ text: 'Preparar', completed: true }] }, saved), true)
  assert.equal(serviceHasChanges({ ...saved, servicePhotoAttached: true }, saved), true)
  assert.equal(serviceHasChanges({ ...saved, updatedAt: 'later' }, saved), false)
  assert.equal(serviceHasChanges({}, null), true)
})
