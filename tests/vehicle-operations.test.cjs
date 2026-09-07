const test = require('node:test')
const assert = require('node:assert/strict')
const { applyVehicleOperation } = require('../api/_lib/vehicle-operation.cjs')

const vehicle = { id: 'vehicle-1', brand: 'Ford', model: 'Ranger', year: 2025, mileage: 1000, plate: 'AA123BB', insuranceExpiresOn: '' }

test('vehículos aplica altas, ediciones y bajas sobre un solo registro', () => {
  const created = applyVehicleOperation({ vehicles: [] }, { operation: 'create', vehicle })
  assert.deepEqual(created.vehicle, vehicle)
  const updated = applyVehicleOperation({ vehicles: created.vehicles }, { operation: 'update', vehicleId: vehicle.id, base: vehicle, vehicle: { ...vehicle, mileage: 1200 } })
  assert.equal(updated.vehicle.mileage, 1200)
  const removed = applyVehicleOperation({ vehicles: updated.vehicles }, { operation: 'delete', vehicleId: vehicle.id, base: updated.vehicle })
  assert.deepEqual(removed.vehicles, [])
})

test('vehículos detecta matrícula duplicada y edición concurrente', () => {
  assert.throws(() => applyVehicleOperation({ vehicles: [vehicle] }, { operation: 'create', vehicle: { ...vehicle, id: 'vehicle-2', plate: 'aa123bb' } }), error => error.code === 'VEHICLE_PLATE_CONFLICT')
  assert.throws(() => applyVehicleOperation({ vehicles: [{ ...vehicle, mileage: 1100 }] }, { operation: 'update', vehicleId: vehicle.id, base: vehicle, vehicle }), error => error.code === 'VEHICLE_WRITE_CONFLICT')
})
