const test = require('node:test')
const assert = require('node:assert/strict')
const { executePreparedCatalogWrite } = require('../api/_lib/prepared-catalog-write.cjs')
const { applyVehicleOperation } = require('../api/_lib/vehicle-operation.cjs')

const vehicle = { id: 'v', brand: 'Ford', model: 'Ranger', year: 2025, mileage: 10, plate: 'AA123BB' }

function fixture() {
  let state = { revision: 1, vehicles: [vehicle], history: [] }, locked = false
  const calls = []
  const sql = async strings => {
    const statement = strings.join('?')
    if (statement.includes('for update')) { locked = true; calls.push('lock'); return [{ value: String(state.revision) }] }
    return []
  }
  sql.query = async () => ({ rows: [{ import_batch: null }] })
  sql.begin = async callback => {
    locked = false
    try { const result = await callback(sql); calls.push('commit'); return result }
    catch (error) { calls.push('rollback'); throw error }
  }
  const options = {
    snapshots: { read: async () => { assert.equal(locked, false); calls.push('read'); return structuredClone(state) }, remember: () => { throw new Error('legacy snapshots are not cached') } },
    persist: async (_sql, _previous, next, revision) => { assert.equal(locked, true); calls.push('persist'); state = { ...next, revision } },
    audit: async () => { assert.equal(locked, true); calls.push('audit') }
  }
  return { sql, calls, options, get state() { return state }, set state(value) { state = value }, get locked() { return locked } }
}

test('catalog preparation retries an unrelated commit before locking without losing either change', async () => {
  const db = fixture()
  let preparations = 0
  const response = await executePreparedCatalogWrite(db.sql, { ...db.options, prepare: current => {
    assert.equal(db.locked, false)
    const operation = applyVehicleOperation(current, { operation: 'update', vehicleId: 'v', base: vehicle, vehicle: { ...vehicle, mileage: 20 } })
    if (!preparations++) db.state = { ...db.state, revision: 2, history: [{ id: 'another', detail: 'concurrent' }] }
    return { next: { ...current, vehicles: operation.vehicles }, entries: [], response: { vehicle: operation.vehicle } }
  } })
  assert.equal(preparations, 2)
  assert.equal(response.revision, 3)
  assert.equal(db.state.vehicles[0].mileage, 20)
  assert.deepEqual(db.state.history, [{ id: 'another', detail: 'concurrent' }])
  assert.deepEqual(db.calls, ['read', 'lock', 'rollback', 'read', 'lock', 'persist', 'audit', 'commit'])
})

test('catalog revalidation never overwrites a concurrently changed record', async () => {
  const db = fixture()
  let preparations = 0
  await assert.rejects(executePreparedCatalogWrite(db.sql, { ...db.options, prepare: current => {
    const operation = applyVehicleOperation(current, { operation: 'update', vehicleId: 'v', base: vehicle, vehicle: { ...vehicle, mileage: 20 } })
    if (!preparations++) db.state = { ...db.state, revision: 2, vehicles: [{ ...vehicle, mileage: 30 }] }
    return { next: { ...current, vehicles: operation.vehicles }, entries: [], response: {} }
  } }), { code: 'VEHICLE_WRITE_CONFLICT', statusCode: 409 })
  assert.equal(db.state.vehicles[0].mileage, 30)
  assert.ok(!db.calls.includes('persist'))
  assert.equal(db.calls.filter(call => call === 'read').length, 2)
})

test('catalog no-op still verifies the revision without writing or auditing', async () => {
  const db = fixture()
  const response = await executePreparedCatalogWrite(db.sql, { ...db.options, prepare: current => ({ next: current, entries: [], response: { vehicles: current.vehicles } }) })
  assert.equal(response.revision, 1)
  assert.deepEqual(db.calls, ['read', 'lock', 'commit'])
})
