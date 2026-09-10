const test = require('node:test')
const assert = require('node:assert/strict')
const { compareApplicationStates, readApplicationState, storageMode } = require('../api/_lib/storage-router.cjs')

const state = passwordHash => ({ revision: 2, roles: [], employees: [{ id: 1, name: 'T', ...(passwordHash ? { passwordHash } : {}) }], services: [], vehicles: [], customers: [], history: [], reviews: [], agenda: { teams: [], weekly: {} }, preferences: { theme: 'light' } })

test('persistent selection is the default while explicit legacy remains available', () => {
  assert.equal(storageMode({}), 'persistent')
  assert.equal(storageMode({ PIGNUS_STORAGE_MODE: 'legacy' }), 'legacy')
  assert.equal(storageMode({ PIGNUS_STORAGE_MODE: 'shadow-read' }), 'shadow-read')
  assert.throws(() => storageMode({ PIGNUS_STORAGE_MODE: 'normalized' }), { code: 'INVALID_STORAGE_MODE' })
})

test('persistent selector returns exactly the active model', async () => {
  const legacy = state('LEGACY'), normalized = state('NORMALIZED')
  assert.equal(await readApplicationState(null, { shadowPrepared: true, readControl: async () => ({ model: 'legacy', revision: 2 }), readLegacy: async () => legacy, readNormalized: async () => normalized }), legacy)
  assert.equal(await readApplicationState(null, { shadowPrepared: true, readControl: async () => ({ model: 'normalized', revision: 2 }), readLegacy: async () => legacy, readNormalized: async () => normalized }), normalized)
  await assert.rejects(readApplicationState(null, { shadowPrepared: true, readControl: async () => ({ model: 'normalized', revision: 3 }), readLegacy: async () => legacy, readNormalized: async () => normalized }), { code: 'STORAGE_CONTROL_READ_CONFLICT' })
})

test('shadow mode compares without exposing credentials and always returns legacy state', async () => {
  const diagnostics = [], legacy = state('SECRET'), normalized = state()
  const result = await readApplicationState(null, { environment: { PIGNUS_STORAGE_MODE: 'shadow-read' }, readLegacy: async () => legacy, readNormalized: async () => normalized, reporter: item => diagnostics.push(item) })
  assert.equal(result, legacy)
  assert.equal(diagnostics[0].status, 'match')
  assert.ok(!JSON.stringify(diagnostics).includes('SECRET'))
  assert.equal(compareApplicationStates(legacy, normalized).equal, true)
})

test('an unavailable or different shadow never replaces the legacy response', async () => {
  const legacy = state('SECRET'), diagnostics = []
  assert.equal(await readApplicationState(null, { environment: { PIGNUS_STORAGE_MODE: 'shadow-read' }, readLegacy: async () => legacy,
    readNormalized: async () => { throw Object.assign(new Error('missing'), { code: 'MISSING' }) }, reporter: item => diagnostics.push(item) }), legacy)
  assert.equal(diagnostics[0].status, 'unavailable')
  const comparison = compareApplicationStates(legacy, { ...state(), history: [{ id: 'extra' }] })
  assert.equal(comparison.equal, false)
  assert.equal(comparison.counts.history.normalized, 1)
})
