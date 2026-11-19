const test = require('node:test')
const assert = require('node:assert/strict')
const gate = require('../api/_lib/technician-agenda-gate.cjs')
const today = '2026-11-19', user = { id: 'tech', roleCode: 'technician' }
const base = { id: 'yesterday', technicianIds: ['tech'], date: '2026-11-18', status: 'Pendiente' }
test('oldest unfinished day gates later dates and reopens after reports', async () => {
 const { technicianAgendaServices } = await import('../src/domain/technicians/technician-history.mjs')
 const records = [base, { ...base, id: 'today', date: today }, { ...base, id: 'tomorrow', date: '2026-11-20' }]
 assert.equal(gate.cutoff(records, user, today), base.date)
 assert.deepEqual(technicianAgendaServices(records, today).map(r => r.id), ['yesterday'])
 records[0] = { ...base, technicalStatus: 'Completado' }
 assert.deepEqual(technicianAgendaServices(records, today).map(r => r.id), ['today'])
 records[1].technicalStatus = 'Reprogramación solicitada'
 assert.deepEqual(technicianAgendaServices(records, today).map(r => r.id), ['tomorrow'])
})
test('resolved, canceled, unconfirmed and other technicians do not block', () => {
 for (const patch of [{ status: 'Completado' }, { status: 'Cancelado' }, { status: 'Avance registrado' }, { status: 'Reprogramado' }, { technicalStatus: 'Reprogramación solicitada' }, { awaitingConfirmation: true }, { technicianIds: ['other'] }]) {
  assert.equal(gate.cutoff([{ ...base, ...patch }], user, today), '', JSON.stringify(patch))
 }
})
test('server projection hides later assignments for legacy and granular technician roles', () => {
 const { visibleStateForUser } = require('../api/_lib/core.cjs')
 const localToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
 const state = { history: [{ ...base, date: '2020-01-01' }, { ...base, id: 'hidden', date: localToday }], employees: [], roles: [], customers: [], vehicles: [], services: [], agenda: { teams: [], weekly: {} }, preferences: {} }
 for (const actor of [user, { ...user, permissions: { __catalogV2: true, 'technical.view': true, 'records.read': true, 'technical.history': true, 'scope.services.read.assigned': true } }]) {
  const result = visibleStateForUser(state, actor)
  assert.ok(result.history.some(r => r.id === 'yesterday'))
  assert.ok(!JSON.stringify(result).includes('hidden'))
 }
})
