const test = require('node:test')
const assert = require('node:assert/strict')

test('identifica el PIG anterior únicamente en clientes convertidos por baja', async () => {
  const { previousSubscriberAccount } = await import('../src/domain/customers/customer-provenance.mjs')

  assert.equal(previousSubscriberAccount({ kind: 'client', account: 'CLI-0042', convertedFromAccount: 'pig-6302' }), 'PIG-6302')
  assert.equal(previousSubscriberAccount({ kind: 'subscriber', account: 'PIG-6302', convertedFromAccount: 'PIG-1000' }), '')
  assert.equal(previousSubscriberAccount({ kind: 'client', account: 'CLI-0043', convertedFromAccount: 'CLI-0001' }), '')
  assert.equal(previousSubscriberAccount({ kind: 'client', account: 'CLI-0044' }), '')
})
