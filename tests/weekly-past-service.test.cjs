const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
test('past services open saved payment information without opening an editor', () => {
  const start = source.indexOf('  const openTaskEditor =')
  const code = source.slice(start, source.indexOf('  const updateTaskDraft', start))
  let viewed
  const open = vm.runInNewContext(code + '\nopenTaskEditor', {
    dayHasFinished: () => true,
    dayPlan: () => ({ teams: [{ label: 'Equipo 1', members: ['Mariano'], tasks: [{ client: 'Cliente', amount: 'viejo' }, {}] }] }),
    taskHasContent: task => Boolean(task.client), operationalHistory: [],
    historyRecordForTask: () => ({ amount: '150000', paymentMethod: 'Transferencia' }),
    setPastService: record => { viewed = record }
  })
  open('2026-09-16', 0, 0)
  assert.equal(viewed.amount, '150000')
  assert.equal(viewed.paymentMethod, 'Transferencia')
  assert.equal(viewed.team, 'Equipo 1')
  viewed = null
  open('2026-09-16', 0, 1)
  assert.equal(viewed, null)
  const modal = source.slice(source.indexOf('{pastService &&'), source.indexOf('{taskEditor && (() =>'))
  assert.match(modal, /SOLO LECTURA/)
  assert.doesNotMatch(modal, /onChange=|Guardar|persistWeeklyService/)
})
