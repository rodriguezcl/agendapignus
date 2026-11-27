const test = require('node:test')
const assert = require('node:assert/strict')

test('el índice semanal respeta los vínculos históricos, su orden y las coincidencias por fecha', async () => {
  const { createTaskHistoryIndex, historyRecordForTask, taskStatus } = await import('../src/features/agenda/application/agenda-model.mjs')
  const visit = { customerId: 'cliente', service: 'Service de alarma', time: '08:30' }
  const history = [
    { id: 'primero', sourceTaskId: 'compartido', date: '2026-11-27', ...visit },
    { id: 'segundo', taskId: 'compartido', date: '2026-11-26', ...visit },
    { id: 'tercero', historyId: 'migrado', sourceHistoryId: 'anterior', status: 'Completado', ...visit },
    { id: 4 }, // Registro antiguo que sólo se identifica por id.
    { id: 'vacio', taskId: 'borrador' }
  ]
  const index = createTaskHistoryIndex(history)
  const day = '2026-11-26'
  for (const [task, expected] of [
    [{ ...visit, taskId: 'compartido', historyId: 'segundo' }, history[0]],
    [{ ...visit, sourceTaskId: 'compartido' }, history[0]],
    [{ ...visit, historyId: 'migrado' }, history[2]],
    [{ ...visit, sourceHistoryId: 'anterior' }, history[2]],
    [{ historyId: '4' }, history[3]],
    [visit, history[1]],
    [{ taskId: 'borrador', detail: 'Servicio nuevo' }, null],
    [{ time: '08:30' }, null]
  ]) {
    assert.equal(historyRecordForTask(task, day, history), expected)
    assert.equal(historyRecordForTask(task, day, index), expected)
    assert.equal(taskStatus(task, day, index), taskStatus(task, day, history))
  }
  const changed = history.map((item, i) => i === 1 ? { ...item, status: 'Cancelado' } : item)
  assert.equal(taskStatus(visit, day, createTaskHistoryIndex(changed)), 'Cancelado')
})
