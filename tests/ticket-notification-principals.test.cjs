const test = require('node:test')
const assert = require('node:assert/strict')
const { loadNotificationPrincipals } = require('../api/_lib/ticket-notification-principals.cjs')

function database(items) {
  const calls = []
  const q = async (sql, args) => {
    calls.push({ sql, args })
    return items.filter(item => args.includes(item.id) || args.includes(String(item.number))).map(item => ({ data: JSON.stringify(item) }))
  }
  return { q, calls }
}
test('50 notificaciones consultan sus tickets en una sola lectura; no conservan datos entre solicitudes', async () => {
  const items = Array.from({ length: 50 }, (_, n) => ({ id: `id-${n}`, number: String(100000+n), status: 'Nuevo' }))
  const db = database(items), ids = items.map(item => item.id)
  const first = await loadNotificationPrincipals(db.q, ids)
  assert.equal(db.calls.length, 1)
  assert.equal(first.size, 50)
  items[0].status = 'Resuelto'
  const second = await loadNotificationPrincipals(db.q, ids)
  assert.equal(second.get('id-0').status, 'Resuelto')
  assert.equal(first.get('id-0').status, 'Nuevo')
})
test('fusiones compartidas, referencias ausentes y cadenas se resuelven por lotes', async () => {
  const db = database([
    {id:'a',number:'1',status:'Fusionado',mergedIntoId:'b'},
    {id:'b',number:'2',status:'Fusionado',mergedIntoId:'c'},
    {id:'c',number:'3',status:'Nuevo'},
    {id:'d',number:'4',status:'Fusionado',mergedIntoId:'missing'}
  ])
  const found = await loadNotificationPrincipals(db.q, ['a','b','d','absent','Ticket#3','ticket#3'])
  assert.equal(found.get('a').id, 'c')
  assert.equal(found.get('b').id, 'c')
  assert.equal(found.get('Ticket#3').id, 'c')
  assert.equal(found.get('ticket#3').id, 'c')
  assert.equal(found.get('d'), null)
  assert.equal(found.get('absent'), null)
  assert.equal(db.calls.length, 2)
})
test('fusiones inválidas mantienen el error y no generan consultas infinitas', async () => {
  for(const items of [
    [{id:'a',status:'Fusionado'}],
    [{id:'a',status:'Fusionado',mergedIntoId:'b'},{id:'b',status:'Fusionado',mergedIntoId:'a'}]
  ]) {
    const db = database(items)
    await assert.rejects(loadNotificationPrincipals(db.q,['a']), error => error.statusCode===409)
    assert.ok(db.calls.length<=2)
  }
})
test('sin avisos no consulta la base', async () => {
  const db = database([])
  assert.equal((await loadNotificationPrincipals(db.q,[])).size,0)
  assert.equal(db.calls.length,0)
})
