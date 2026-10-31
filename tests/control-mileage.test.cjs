const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleTechnicianStateForUser } = require('../api/_lib/core.cjs')

test('el control usa el kilometraje corregido, valida errores y espera datos de Flota', async () => {
  const { controlMileage } = await import('../src/domain/vehicles/control-mileage.mjs')
  assert.equal(controlMileage({ mileage: 800000 }, '80100').valid, false)
  assert.equal(controlMileage({ mileage: 80000 }, '80100').valid, true)
  assert.equal(controlMileage({ mileage: 80200 }, '80100').valid, false)
  for (const value of ['', '80000', '79999', '-1', '80.100', '80100,5', '1e6', '100000000']) {
    assert.equal(controlMileage({ mileage: 80000 }, value).valid, false, value)
  }
  assert.equal(controlMileage(undefined, '80100').ready, false)
  assert.equal(controlMileage({ mileage: null }, '1').valid, true)
})

test('la proyección técnica informa el valor vigente sólo para vehículos de controles asignados', () => {
  const state = { revision: 1, roles: [], employees: [], services: [], customers: [], agenda: {}, preferences: {},
    vehicles: [{ id: 'v1', mileage: 80000, internalNote: 'privado' }, { id: 'v2', mileage: 90000 }],
    history: [{ id: 'control', technicianIds: ['tech'], vehicleControl: true, vehicleId: 'v1', vehicleMileageAtScheduling: 800000 }] }
  const projected = visibleTechnicianStateForUser(state, { id: 'tech', roleCode: 'technician', permissions: {} })
  assert.equal(projected.vehicles[0].mileage, 80000)
  assert.equal(projected.vehicles[0].internalNote, undefined)
  assert.equal(projected.vehicles[1].mileage, undefined)
  assert.equal(projected.history[0].vehicleMileageAtScheduling, 800000)
})

test('un conflicto devuelve la referencia vigente al formulario sin reintentar el envío', async () => {
  const { submitTechnicianStatus } = await import('../src/infrastructure/http/technician-status.mjs')
  let calls = 0
  await assert.rejects(submitTechnicianStatus({ recordId: 'control', type: 'Completado', vehicleControl: true,
    vehicleMileage: 80100, fetcher: async () => {
      calls++
      return { ok: false, status: 409, json: async () => ({ error: 'Kilometraje desactualizado', code: 'VEHICLE_MILEAGE_CONFLICT', currentMileage: 80200 }) }
    } }), error => error.status === 409 && error.code === 'VEHICLE_MILEAGE_CONFLICT' && error.currentMileage === 80200)
  assert.equal(calls, 1)
})
