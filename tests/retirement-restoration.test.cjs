const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeRetirementCustomers } = require('../api/_lib/core.cjs')

function fixture() {
  const reference = { customerId: 'customer', clientAccount: 'PIG-123', client: 'PIG-123 CLIENTE' }
  const task = { ...reference, taskId: 'task', historyId: 'retirement' }
  return normalizeRetirementCustomers({
    customers: [{ ...reference, account: 'PIG-123', kind: 'subscriber', name: 'CLIENTE', type: 'Residencial', phone: '3515555555' }],
    history: [{ ...reference, id: 'retirement', service: 'Retiro de equipo', status: 'Completado' }, { ...reference, id: 'old', service: 'Instalación', status: 'Completado' }],
    reviews: [{ ...reference, id: 'review' }],
    agenda: { teams: [{ tasks: [task] }], weekly: { '2026-09-22': { teams: [{ tasks: [task] }] } } }
  }).state
}

for (const status of ['Cancelado', 'Pendiente']) {
  test(`corregir el retiro a ${status} restaura PIG y referencias conservando la identidad`, () => {
    const previous = fixture(), next = structuredClone(previous)
    next.history[0].status = status
    const result = normalizeRetirementCustomers(next, previous)
    const customer = result.state.customers[0]
    assert.equal(customer.account, 'PIG-123')
    assert.equal(customer.kind, 'subscriber')
    assert.equal(customer.type, 'Residencial')
    assert.equal(customer.customerId, 'customer')
    assert.equal(customer.phone, previous.customers[0].phone)
    assert.equal(customer.subscriptionEndedAt, undefined)
    assert.equal(customer.convertedFromAccount, undefined)
    assert.equal(result.conversions.length, 1)
    for (const record of [...result.state.history, ...result.state.reviews, ...result.state.agenda.teams[0].tasks, ...result.state.agenda.weekly['2026-09-22'].teams[0].tasks]) {
      assert.equal(record.clientAccount, 'PIG-123')
      assert.equal(record.client, 'PIG-123 CLIENTE')
      assert.equal(record.customerId, 'customer')
    }
    assert.equal(previous.history[0].status, 'Completado')
    assert.equal(normalizeRetirementCustomers(result.state, result.state).conversions.length, 0)
  })
}

test('otro retiro completado conserva el CLI hasta corregir el último', () => {
  const previous = fixture()
  previous.history.push({ ...previous.history[0], id: 'second' })
  const next = structuredClone(previous); next.history[0].status = 'Cancelado'
  assert.equal(normalizeRetirementCustomers(next, previous).state.customers[0].kind, 'client')
  const final = structuredClone(next); final.history[2].status = 'Pendiente'
  assert.equal(normalizeRetirementCustomers(final, next).state.customers[0].account, 'PIG-123')
})

test('colisión del PIG rechaza la corrección sin mutar datos', () => {
  const previous = fixture(), next = structuredClone(previous)
  next.history[0].status = 'Cancelado'
  next.customers.push({ customerId: 'other', account: 'PIG-123', kind: 'subscriber' })
  const before = structuredClone(next)
  assert.throws(() => normalizeRetirementCustomers(next, previous), /pertenece a otro registro/)
  assert.deepEqual(next, before)
})

test('datos heredados recuperan el PIG conocido; no se restauran clientes sin conversión ni por guardados ajenos', () => {
  const previous = fixture(), next = structuredClone(previous)
  next.history[0].status = 'Cancelado'
  delete next.customers[0].convertedFromType
  assert.equal(normalizeRetirementCustomers(next, previous).state.customers[0].type, 'Abonado')
  assert.equal(normalizeRetirementCustomers(next).state.customers[0].kind, 'client')
  assert.equal(normalizeRetirementCustomers(next, next).state.customers[0].kind, 'client')
  delete next.customers[0].convertedFromAccount
  assert.equal(normalizeRetirementCustomers(next, previous).state.customers[0].kind, 'client')
})

test('restitución con PIG duplicado compatible reúne referencias y conserva los datos de ambos registros', () => {
  const previous = fixture()
  previous.customers[0].name = 'LEONEL MARTÍNEZ'
  previous.customers[0].phone = '0351153848310'
  previous.customers[0].internalNote = 'Nota del CLI'
  previous.customers[0].cctvService = true
  previous.customers.push({ customerId: 'imported', account: 'PIG-123', kind: 'subscriber', name: 'Martinez, Leonel', phone: '0351153848310', fields: { imported: 'dato' } })
  previous.history.push({ id: 'pig-history', customerId: 'imported', clientAccount: 'PIG-123', status: 'Completado', service: 'Instalación' })
  previous.history.push(...[1, 2].map(index => ({ ...previous.history[1], id: `journey-${index}`, status: index === 1 ? 'Avance registrado' : 'Completado', serviceJourney: { id: 'journey-1', index, total: 2 }, technicalObservation: `Informe ${index}`, address: `Dirección histórica ${index}` })))
  const next = structuredClone(previous); next.history[0].status = 'Cancelado'
  const result = normalizeRetirementCustomers(next, previous)
  assert.equal(result.state.customers.length, 1)
  const customer = result.state.customers[0]
  assert.equal(customer.customerId, 'imported')
  assert.equal(customer.account, 'PIG-123')
  assert.equal(customer.cctvService, true)
  assert.equal(customer.internalNote, 'Nota del CLI')
  assert.equal(customer.mergedRetirementCustomers[0].customerId, 'customer')
  assert.equal(customer.fields.imported, 'dato')
  for (const record of [...result.state.history, ...result.state.reviews, ...result.state.agenda.teams[0].tasks]) assert.equal(record.customerId, 'imported')
  assert.equal(result.state.history[0].status, 'Cancelado')
  assert.equal(previous.customers.length, 2)
  const { synchronizeJourneyIdentity } = require('../api/_lib/journey-identity.cjs')
  assert.doesNotThrow(() => synchronizeJourneyIdentity(result.state, previous))
  for (const index of [1, 2]) {
    const record = result.state.history.find(item => item.id === `journey-${index}`)
    assert.equal(record.technicalObservation, `Informe ${index}`)
    assert.equal(record.address, `Dirección histórica ${index}`)
  }
  const invalid = structuredClone(result.state)
  invalid.history.find(item => item.id === 'journey-1').service = 'Otro servicio'
  assert.throws(() => synchronizeJourneyIdentity(invalid, previous), /protegidos/)
})

test('coincidencia tolera formato y acentos, pero exige nombre y otro dato significativo', () => {
  const { matchesRetiredSubscriber } = require('../api/_lib/retirement-customer-match.cjs')
  const client = { name: 'LEONEL MARTÍNEZ', phone: '03515384831', address: 'Av. de Mayo 1534, Córdoba' }
  assert.equal(matchesRetiredSubscriber(client, { name: 'Martinez Leonel', phone: '+54 9 351 5384831' }), true)
  assert.equal(matchesRetiredSubscriber({ ...client, phone: '0351 15 5384831' }, { name: 'Martinez Leonel', phone: '+54 9 351 5384831' }), true)
  assert.equal(matchesRetiredSubscriber(client, { name: 'Leonel Martinez', address: 'Avenida de Mayo 1534 - Cordoba' }), true)
  assert.equal(matchesRetiredSubscriber(client, { name: 'LEONEL MARTINEZ' }), false)
  assert.equal(matchesRetiredSubscriber(client, { name: 'OTRO CLIENTE', phone: client.phone }), false)
  assert.equal(matchesRetiredSubscriber({ name: '-', phone: '-' }, { name: '-', phone: '-' }), false)
})

test('un retiro válido del PIG existente impide unirlo con el CLI corregido', () => {
  const previous = fixture()
  previous.customers.push({ ...previous.customers[0], customerId: 'imported', account: 'PIG-123', kind: 'subscriber' })
  previous.history.push({ ...previous.history[0], id: 'other-retirement', customerId: 'imported' })
  const next = structuredClone(previous); next.history[0].status = 'Cancelado'
  assert.throws(() => normalizeRetirementCustomers(next, previous), /otro retiro completado/)
})

test('la base normalizada conserva el tipo original y persiste la restitución sin duplicar cuentas', async () => {
  const fs = require('node:fs'), path = require('node:path')
  const { PGlite } = await import('@electric-sql/pglite')
  const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
  const { readNormalizedState, synchronizeNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
  const pg = await PGlite.create()
  const initial = {
    revision: 1, roles: [], employees: [], vehicles: [], reviews: [], preferences: { theme: 'light' },
    services: [{ id: 'retirement', code: 'retirement', name: 'Retiro de equipo', estimatedMinutes: 60 }],
    customers: [{ customerId: 'customer', account: 'PIG-123', kind: 'subscriber', name: 'CLIENTE', type: 'Residencial', fields: {} }],
    history: [{ id: 'record', customerId: 'customer', clientAccount: 'PIG-123', client: 'PIG-123 CLIENTE', serviceId: 'retirement', service: 'Retiro de equipo', status: 'Completado', date: '2026-09-22', time: '14:30', estimatedMinutes: 60, technicianIds: [] }],
    agenda: { date: '2026-09-22', teams: [], weekly: {} }
  }
  const converted = normalizeRetirementCustomers(initial).state
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    await insertShadowCandidate(pg, buildShadowCandidate(converted))
    const stored = await readNormalizedState(pg)
    assert.equal(stored.customers[0].convertedFromType, 'Residencial')
    const corrected = structuredClone(stored); corrected.history[0].status = 'Cancelado'
    const restored = normalizeRetirementCustomers(corrected, stored).state; restored.revision = 2
    await synchronizeNormalizedState(pg, stored, restored)
    const actual = await readNormalizedState(pg)
    assert.deepEqual(actual, JSON.parse(JSON.stringify(restored)))
    assert.equal(actual.customers.length, 1)
    assert.equal(actual.customers[0].account, 'PIG-123')
    assert.equal(actual.history[0].clientAccount, 'PIG-123')
    const completedAgain = structuredClone(actual); completedAgain.history[0].status = 'Completado'
    const duplicated = normalizeRetirementCustomers(completedAgain, actual).state
    duplicated.customers.push({ ...initial.customers[0], customerId: 'imported-pig', address: 'Calle 123' })
    duplicated.customers[0].address = 'Calle 123'
    duplicated.revision = 3
    await synchronizeNormalizedState(pg, actual, duplicated)
    const cancelling = structuredClone(duplicated); cancelling.history[0].status = 'Cancelado'
    const reunited = normalizeRetirementCustomers(cancelling, duplicated).state; reunited.revision = 4
    await synchronizeNormalizedState(pg, duplicated, reunited)
    const final = await readNormalizedState(pg)
    assert.deepEqual(final, JSON.parse(JSON.stringify(reunited)))
    assert.equal(final.customers.length, 1)
    assert.equal(final.customers[0].customerId, 'imported-pig')
    assert.equal(final.history[0].customerId, 'imported-pig')
    assert.equal(final.customers[0].mergedRetirementCustomers[0].customerId, 'customer')
  } finally { await pg.close() }
})
