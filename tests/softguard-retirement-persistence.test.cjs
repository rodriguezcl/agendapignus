const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState, synchronizeNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')

test('normalized storage preserves a SoftGuard resolution and removes it when the subscriber is restored', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const pending = {
      revision: 1, roles: [], employees: [], services: [], vehicles: [], history: [], reviews: [],
      agenda: { date: '2026-10-20', teams: [], weekly: {} }, preferences: { theme: 'light' },
      customers: [{ customerId: 'retired', kind: 'client', account: 'CLI-0176', name: 'CLIENTE',
        convertedFromAccount: 'PIG-1234', convertedFromType: 'Abonado', subscriptionEndedAt: '2026-10-20T19:02:00.000Z' }]
    }
    await insertShadowCandidate(pg, buildShadowCandidate(pending))
    const completed = structuredClone(pending)
    completed.revision++
    completed.customers[0].softguardRetirementResolution = {
      convertedFromAccount: 'PIG-1234', subscriptionEndedAt: '2026-10-20T19:02:00.000Z',
      completedAt: '2026-10-20T20:10:00.000Z', completedBy: 'user-1', completedByName: 'Responsable'
    }
    await synchronizeNormalizedState(pg, pending, completed)
    assert.deepEqual(await readNormalizedState(pg), completed)
    const renamed = structuredClone(completed)
    renamed.revision++
    renamed.customers[0].name = 'CLIENTE ACTUALIZADO'
    await synchronizeNormalizedState(pg, completed, renamed)
    assert.deepEqual((await readNormalizedState(pg)).customers, renamed.customers)
    const restored = structuredClone(renamed)
    restored.revision++
    const customer = restored.customers[0]
    customer.kind = 'subscriber'
    customer.account = customer.convertedFromAccount
    for (const key of ['convertedFromAccount', 'convertedFromType', 'subscriptionEndedAt', 'softguardRetirementResolution']) delete customer[key]
    await synchronizeNormalizedState(pg, renamed, restored)
    assert.deepEqual(await readNormalizedState(pg), restored)
  } finally { await pg.close() }
})
