const test = require('node:test')
const assert = require('node:assert/strict')
const { serviceObservations, ticketServiceObservations } = require('../api/_lib/service-observation-history.cjs')
const original = { technicalObservation: 'Sin internet, requiere reprogramar.', technicalStatus: 'Reprogramación solicitada', technicalReportedById: 'tech', technicalReportedByName: 'Rodrigo', technicalReportedAt: '2026-11-18T14:00:00Z' }
const record = { id: 'service', sourceTicketId: 'ticket', technicalObservation: 'Corrección administrativa: esperamos al cliente.', technicalStatus: 'Completado', technicalReportedById: 'admin', technicalReportedByName: 'Leonardo', technicalReportedAt: '2026-11-19T13:00:00Z', workCompletion: { corrections: [{ at: '2026-11-19T13:00:00Z', actor: { id: 'admin' }, previous: original }] } }
test('existing corrections expose original and administrative observations without modifying storage', () => {
 const before = structuredClone(record), reports = serviceObservations(record)
 assert.deepEqual(reports.map(r => [r.label, r.byName, r.body]), [['Informe técnico', 'Rodrigo', original.technicalObservation], ['Corrección administrativa', 'Leonardo', record.technicalObservation]])
 assert.deepEqual(record, before)
})
test('ticket includes linked observations only when service is readable, with stable IDs', () => {
 const ticket = { id: 'ticket', number: 159, serviceIds: ['service'] }
 const records = [record, { ...record, id: 'other', sourceTicketId: 'other-ticket' }]
 const reports = ticketServiceObservations(ticket, records, () => true)
 assert.equal(reports.length, 2)
 assert.deepEqual(reports, ticketServiceObservations(ticket, records, () => true))
 assert.deepEqual(ticketServiceObservations(ticket, records, () => false), [])
 assert.ok(reports.every(r => r.sourceServiceId === 'service'))
})
