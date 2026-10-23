const test = require('node:test')
const assert = require('node:assert/strict')
const { synchronizeTicketServices, readyToResolve } = require('../api/_lib/ticket-service-lifecycle.cjs')
const { defaultConfig } = require('../api/_lib/tickets.cjs')
const clone = value => value && JSON.parse(JSON.stringify(value))
const NOW = '2026-10-23T15:00:00.000Z'
const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
function fixture({ linked = true, extra = [] } = {}) {
  const tickets = new Map([
    ['z-alias', { id: 'z-alias', number: '1000001', status: 'Fusionado', mergedIntoId: 'b-alias', serviceIds: linked ? ['visit'] : [] }],
    ['b-alias', { id: 'b-alias', number: '1000002', status: 'Fusionado', mergedIntoId: 'a-principal', serviceIds: linked ? ['visit'] : [] }],
    ['a-principal', { id: 'a-principal', number: '1000003', version: 1, status: 'En gestión', priority: 'Alta', createdAt: NOW, customerId: '', serviceIds: linked ? ['visit'] : [], resolutionServiceIds: linked ? ['visit'] : [], participantIds: [] }],
    ...extra.map(value => [value.id, value])
  ])
  const events = [], saved = [], locks = []
  const store = {
    settings: async () => ({ config: defaultConfig() }),
    ticket: async (_q, key) => clone(tickets.get(String(key)) || [...tickets.values()].find(item => item.number === String(key))),
    save: async (_q, item) => { tickets.set(item.id, clone(item)); saved.push(item.id) },
    communicate: async (_q, item, type) => events.push({ ticketId: item.id, type })
  }
  const q = async (query, args) => {
    if (query.includes('ORDER BY id FOR UPDATE')) { locks.push([...args]); return args.map(id => ({ id })) }
    if (query.includes("'serviceIds'")) return [...tickets.values()].filter(item => item.serviceIds?.includes(JSON.parse(args[0])[0])).map(item => ({ id: item.id }))
    if (query.includes('$.serviceIds')) return [...tickets.values()].filter(item => item.serviceIds?.includes(args[0])).map(item => ({ id: item.id }))
    throw new Error('Consulta inesperada: ' + query)
  }
  return { tickets, events, saved, locks, store, q }
}
const visit = (patch = {}) => ({ id: 'visit', sourceTicketId: 'z-alias', ticketNumber: '1000001', date: '2026-10-23', time: '10:00', teamId: 'team-1', status: 'Pendiente', ...patch })
const state = records => ({ history: records, customers: [] })

test('Tickets fusionados: una nueva jornada admite el número original y se vincula al principal', async () => {
  const env = fixture({ linked: false }), record = visit()
  await synchronizeTicketServices({ ...env, pg: true, previous: state([]), next: state([record]), user: admin, now: NOW })
  const principal = env.tickets.get('a-principal')
  assert.deepEqual(principal.serviceIds, ['visit'])
  assert.deepEqual(principal.resolutionServiceIds, ['visit'])
  assert.equal(record.ticketNumber, '1000001')
  assert.equal(record.sourceTicketId, 'z-alias')
  assert.deepEqual(env.events, [{ ticketId: 'a-principal', type: 'scheduled' }])
  assert.deepEqual(env.locks, [['a-principal', 'b-alias', 'z-alias']])
})

test('Tickets fusionados: el informe que conserva el ID original resuelve el principal una sola vez', async () => {
  const env = fixture(), before = visit()
  const after = visit({ status: 'Completado', technicalStatus: 'Completado', technicalReportedAt: NOW, technicalObservation: 'Se reparó la cámara.', ticketResolution: { resolved: true, ticketIds: ['z-alias'], at: NOW } })
  assert.equal(readyToResolve(env.tickets.get('a-principal'), [after]), false)
  assert.equal(readyToResolve(env.tickets.get('a-principal'), [after], ['a-principal', 'z-alias']), true)
  await synchronizeTicketServices({ ...env, pg: true, previous: state([before]), next: state([after]), user: admin, now: NOW, reportRecordId: 'visit' })
  assert.equal(env.tickets.get('a-principal').status, 'Resuelto')
  assert.equal(env.tickets.get('a-principal').resolvedByServiceId, 'visit')
  assert.equal(env.tickets.get('z-alias').status, 'Fusionado')
  assert.deepEqual(env.events, [{ ticketId: 'a-principal', type: 'resolved' }])
  assert.deepEqual(env.saved, ['a-principal'])
})

test('Tickets fusionados: mencionar otro caso en el informe no lo cierra ni modifica su reloj', async () => {
  const unrelated = { id: 'unrelated', number: '1000010', version: 1, status: 'En gestión', priority: 'Alta', serviceIds: ['other-visit'], resolutionServiceIds: ['other-visit'], participantIds: [], sla: { version: 1, startedAt: '2026-01-01' } }
  const env = fixture({ extra: [unrelated] }), before = visit()
  const after = visit({ status: 'Completado', technicalStatus: 'Completado', technicalReportedAt: NOW, technicalObservation: 'Cámara reparada.', ticketResolution: { resolved: true, ticketIds: ['z-alias', 'unrelated', 'missing'], at: NOW } })
  await synchronizeTicketServices({ ...env, pg: true, previous: state([before]), next: state([after]), user: admin, now: NOW, reportRecordId: 'visit' })
  assert.equal(env.tickets.get('a-principal').status, 'Resuelto')
  assert.deepEqual(env.tickets.get('unrelated'), unrelated)
  assert.deepEqual(env.saved, ['a-principal'])
})

test('Tickets fusionados: un número ajeno se rechaza aun cuando el ID sea un alias válido', async () => {
  const env = fixture({ linked: false })
  await assert.rejects(() => synchronizeTicketServices({ ...env, pg: false, previous: state([]), next: state([visit({ ticketNumber: '9999999' })]), user: admin, now: NOW }), error => error.statusCode === 409 && /referencia visible/.test(error.message))
  assert.deepEqual(env.saved, [])
})

test('Tickets fusionados: cambios de destino durante la toma de bloqueos piden reintento', async () => {
  const env = fixture({ linked: false, extra: [{ id: 'new-principal', number: '1000090', status: 'En gestión', serviceIds: [] }] })
  const q = async (query, args) => {
    const result = await env.q(query, args)
    if (query.includes('ORDER BY id FOR UPDATE')) env.tickets.get('b-alias').mergedIntoId = 'new-principal'
    return result
  }
  await assert.rejects(() => synchronizeTicketServices({ ...env, q, pg: true, previous: state([]), next: state([visit()]), user: admin, now: NOW }), error => error.statusCode === 409 && /cambió durante/.test(error.message))
  assert.deepEqual(env.saved, [])
})
