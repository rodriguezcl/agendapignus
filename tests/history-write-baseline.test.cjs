const test = require('node:test')
const assert = require('node:assert/strict')
const { recordBaseMatches } = require('../api/_lib/endpoint-policy.cjs')
const user = { id: 'admin', roleCode: 'administrator' }
test('legacy comparison ignores object order but detects real edits', () => {
 const original = { id: 'one', detail: 'Original', nested: { a: 1, b: 2 } }
 assert.equal(recordBaseMatches(original, { nested: { b: 2, a: 1 }, detail: 'Original', id: 'one' }, user), true)
 assert.equal(recordBaseMatches(original, { ...original, detail: 'Cambio remoto' }, user), false)
})
test('history writes use stored baseline and only user changes, without rebasing stale forms', async () => {
 const { alignHistoryWrite } = await import('../src/features/history/application/history-write-baseline.mjs')
 const stored = { id: 'one', status: 'Pendiente', detail: 'Original' }
 const shown = { ...stored, estimatedMinutes: 60, estimatedMinutesCustomized: false, clientAccount: 'CLI-1' }
 const display = { history: [shown] }, server = { revision: 2, history: [stored] }
 const proposal = { ...shown, status: 'Completado' }
 const result = alignHistoryWrite(shown, proposal, display, server, 2)
 assert.deepEqual(result.base, stored)
 assert.deepEqual(result.record, { ...stored, status: 'Completado' })
 assert.equal(recordBaseMatches(stored, result.base, user), true)
 const changed = { ...stored, detail: 'Modificado en otra sesión' }
 assert.equal(recordBaseMatches(changed, result.base, user), false)
 assert.equal(alignHistoryWrite(shown, proposal, {history:[{...shown,detail:'Nuevo'}]},server,2).base, shown)
 assert.equal(alignHistoryWrite(shown, proposal, display,server,3).base, shown)
 assert.deepEqual(alignHistoryWrite(shown, null, display,server,2).base,stored)
})

test('PIG reservation can be linked and completed after rescheduling without a false conflict', async () => {
 const { alignHistoryWrite } = await import('../src/features/history/application/history-write-baseline.mjs')
 const { customerLinkPatch } = await import('../src/features/agenda/application/customer-linking.mjs')
 const { assertServiceCanBeCompleted } = require('../api/_lib/service-completion.cjs')
 const reservation = { id: 'reservation', date: '2026-11-20', rescheduledFrom: '2026-11-19', status: 'Pendiente', subscriberReservation: true, client: 'Cliente nuevo' }
 const customer = { customerId: 'customer', account: 'PIG-1234', name: 'Cliente nuevo', address: 'Domicilio', phone: '123' }
 const displayed = { ...reservation, estimatedMinutes: 120, estimatedMinutesCustomized: false }
 const link = alignHistoryWrite(displayed, {...displayed, ...customerLinkPatch(displayed, customer, user)}, {history:[displayed]}, {revision:10,history:[reservation]}, 10)
 assert.equal(recordBaseMatches(reservation, link.base, user), true)
 assert.equal(link.record.subscriberReservation, false)
 assert.equal(link.record.customerId, customer.customerId)
 const saved = JSON.parse(JSON.stringify(link.record))
 const shown = {...saved, estimatedMinutes:120, estimatedMinutesCustomized:false}
 const completed = alignHistoryWrite(shown, {...shown,status:'Completado'}, {history:[shown]}, {revision:11,history:[saved]}, 11)
 assert.equal(recordBaseMatches(saved, completed.base, user), true)
 assert.equal(completed.record.status,'Completado')
 assert.equal(completed.record.rescheduledFrom,'2026-11-19')
 assert.equal(completed.record.customerId,customer.customerId)
 assert.equal(recordBaseMatches({...saved,customerId:'different'},completed.base,user),false)
 assert.doesNotThrow(()=>assertServiceCanBeCompleted({...saved,date:'2026-11-19'},'2026-11-20T15:00:00Z'))
})
