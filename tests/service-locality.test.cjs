const test = require('node:test')
const assert = require('node:assert/strict')

test('weekly locality uses linked customer locality, not the service address', async () => {
  const { createServiceLocalityLookup } = await import('../src/domain/agenda/service-locality.mjs')
  const lookup = createServiceLocalityLookup([
    { customerId: 'a', account: 'PIG-6443', locality: ' Docta Urbanización ' },
    { customerId: 'b', account: 'CLI-0012', locality: 'Cerro de las Rosas' },
    { customerId: 'c', account: 'PIG-0001', locality: '  ' }
  ])
  assert.equal(lookup({ customerId: 'a' }), 'DOCTA URBANIZACIÓN')
  assert.equal(lookup({ client: 'PIG-6443 JOSE IGNACIO GARZON' }), 'DOCTA URBANIZACIÓN')
  assert.equal(lookup({ clientAccount: 'cli-0012' }), 'CERRO DE LAS ROSAS')
  assert.equal(lookup({ customerId: 'b', client: 'PIG-6443 NOMBRE ANTERIOR' }), 'CERRO DE LAS ROSAS')
  assert.equal(lookup({ customerId: 'deleted', clientAccount: 'PIG-6443' }), '')
  assert.equal(lookup({ customerId: 'c', address: 'Docta' }), '')
  assert.equal(lookup({ client: 'RESERVA', address: 'Docta' }), '')
  assert.equal(lookup({ vehicleControl: true, customerId: 'a' }), '')
  assert.equal(lookup({}), '')
})
