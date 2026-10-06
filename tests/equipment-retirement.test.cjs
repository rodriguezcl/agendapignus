const test = require('node:test')
const assert = require('node:assert/strict')

test('retiro de insumos no es baja; retiro de equipo sí', async () => {
  const { isEquipmentRetirementRecord: isRetirement } = await import('../src/domain/services/equipment-retirement.mjs')
  assert.equal(isRetirement({ service: 'Retiro de insumos' }), false)
  assert.equal(isRetirement({ service: 'Retiro de compras del proveedor' }), false)
  assert.equal(isRetirement({ service: 'Retiro de equipo' }), true)
  assert.equal(isRetirement({ service: ' RETIRO DE EQUIPOS ' }), true)
  assert.equal(isRetirement({}), false)
})

test('multiservicio usa tipos seleccionados y cuenta una sola baja real', async () => {
  const { isEquipmentRetirementRecord: isRetirement } = await import('../src/domain/services/equipment-retirement.mjs')
  const records = [
    { service: 'Retiro de equipo', serviceTypes: [{ name: 'Retiro de insumos' }, { name: 'Service de cámaras' }] },
    { serviceTypes: [{ name: 'Retiro de insumos' }, { name: 'Retiro de equipo' }] }
  ]
  assert.equal(isRetirement(records[0]), false)
  assert.equal(records.filter(isRetirement).length, 1)
  assert.equal(records.length, 2, 'ambos siguen siendo trabajos realizados')
})
