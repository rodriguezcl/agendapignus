const test = require('node:test')
const assert = require('node:assert/strict')

test('empleados se ordenan por nombre en español sin modificar los originales', async () => {
  const { sortEmployeesAlphabetically } = await import('../src/domain/shared/catalog-order.mjs')
  const records = [{ name: 'Santos Díaz' }, { name: 'álvaro Pérez' }, { name: 'Mariano Díaz' }]
  const before = structuredClone(records)
  assert.deepEqual(sortEmployeesAlphabetically(records).map(x => x.name), ['álvaro Pérez', 'Mariano Díaz', 'Santos Díaz'])
  assert.deepEqual(records, before)
})

test('vehículos se ordenan por marca, modelo y matrícula sin mutar la flota', async () => {
  const { sortVehiclesAlphabetically } = await import('../src/domain/shared/catalog-order.mjs')
  const fleet = [{ brand: 'Renault', model: 'Kangoo', plate: 'NUG343' }, { brand: 'Peugeot', model: 'Partner', plate: 'AG841ZP' }, { brand: 'Ford', model: 'Ka', plate: 'B' }, { brand: 'Ford', model: 'Ka', plate: 'A' }]
  const before = structuredClone(fleet)
  assert.deepEqual(sortVehiclesAlphabetically(fleet).map(x => x.plate), ['A', 'B', 'AG841ZP', 'NUG343'])
  assert.deepEqual(fleet, before)
})
