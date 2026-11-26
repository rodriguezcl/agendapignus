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
  const saved = Object.fromEntries(serviceEditableFields.map(key => [key, key === 'freezeMonthlyFee' ? false : key === 'frozenMonths' ? 0 : 'original']))
  assert.equal(serviceHasChanges(saved, saved), false)
  for (const key of serviceEditableFields) {
    const edited = { ...saved, [key]: key === 'freezeMonthlyFee' ? true : key === 'frozenMonths' ? 3 : 'changed' }
    assert.equal(serviceHasChanges(edited, saved), true, key)
    assert.equal(serviceHasChanges(edited, edited), false, key)
  }
  assert.equal(serviceHasChanges({ ...saved, internalChecklist: [{ text: 'Preparar', completed: true }] }, saved), true)
  assert.equal(serviceHasChanges({ ...saved, servicePhotoAttached: true }, saved), true)
  assert.equal(serviceHasChanges({ ...saved, updatedAt: 'later' }, saved), false)
  assert.equal(serviceHasChanges({}, null), true)
})

test('discard preserves an unanswered freeze choice independently of an explicit yes or no', async () => {
  const { restoreSavedService, serviceHasChanges } = await import('../src/domain/agenda/service-changes.mjs')
  for (const freezeMonthlyFee of [undefined, null, false, true]) {
    const saved = { id: 'saved', freezeMonthlyFee }
    const restored = restoreSavedService({ taskId: 'task', freezeMonthlyFee: freezeMonthlyFee !== true }, saved)
    assert.equal(restored.freezeMonthlyFee, freezeMonthlyFee ?? null)
    assert.equal(serviceHasChanges(restored, saved), false)
    assert.equal(restored.taskId, 'task')
    assert.equal(restored.historyId, 'saved')
  }
})
test('las cantidades de materiales cuentan como edición y descartar recupera la entrega guardada', async () => {
  const { serviceHasChanges, restoreSavedService } = await import('../src/domain/agenda/service-changes.mjs')
  const { agendaHasUnsavedServices } = await import('../src/domain/agenda/unsaved-agenda.mjs')
  const line = { productId: 'sensor', model: 'PIR', name: 'Sensor PIR', quantity: 2 }
  const record = { id: 'work-1', date: '2099-10-08', teamId: 'A', materials: [line] }
  const task = { historyId: 'work-1', materials: [{ ...line, quantity: 3 }] }
  const inAgenda = task => agendaHasUnsavedServices({ teams: [{ teamId: 'A', tasks: [task] }], history: [record], date: record.date })
  assert.equal(serviceHasChanges(task, record), true)
  assert.equal(inAgenda(task), true)
  const restored = restoreSavedService(task, record)
  assert.deepEqual(restored.materials, record.materials)
  assert.notEqual(restored.materials[0], record.materials[0])
  assert.equal(inAgenda(restored), false)
  assert.equal(serviceHasChanges({}, { materials: [] }), false)
})
