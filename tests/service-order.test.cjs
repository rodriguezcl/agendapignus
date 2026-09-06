const test = require('node:test')
const assert = require('node:assert/strict')

test('ordena los tipos de servicio alfabéticamente en español sin alterar el catálogo', async () => {
  const { sortServicesAlphabetically } = await import('../src/service-order.mjs')
  const services = [
    { id: '3', name: 'Service de cámaras' },
    { id: '1', name: 'Instalación de alarma' },
    { id: '2', name: 'Cambio de titularidad' },
    { id: '4', name: 'Árbol técnico 10' },
    { id: '5', name: 'Arbol técnico 2' }
  ]

  const sorted = sortServicesAlphabetically(services)

  assert.deepEqual(sorted.map(service => service.name), [
    'Arbol técnico 2',
    'Árbol técnico 10',
    'Cambio de titularidad',
    'Instalación de alarma',
    'Service de cámaras'
  ])
  assert.deepEqual(services.map(service => service.id), ['3', '1', '2', '4', '5'])
})
