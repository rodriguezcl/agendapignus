const test = require('node:test')
const assert = require('node:assert/strict')

test('detects a reimported PIG only with matching original account and full name', async () => {
  const { softguardVerificationCases: detect } = await import('../src/domain/customers/softguard-verification.mjs')
  const cli = { customerId: 'cli', kind: 'client', account: 'CLI-0069', name: 'NICOLAS SEIA', convertedFromAccount: 'PIG-6583' }
  const pig = { customerId: 'pig', kind: 'subscriber', account: 'PIG-6583', name: 'NICOLAS SEIA' }
  const input = [cli, pig]
  const snapshot = JSON.stringify(input)
  assert.equal(detect(input).length, 1)
  assert.equal(detect(input)[0].clients[0].account, 'CLI-0069')
  assert.equal(detect(input)[0].account, 'PIG-6583')
  assert.equal(JSON.stringify(input), snapshot)
  assert.equal(detect([cli]).length, 0)
  assert.equal(detect([pig]).length, 0)
  assert.equal(detect([cli, { ...pig, account: 'PIG-6584' }]).length, 0)
  for (const name of ['OTRA PERSONA', 'SEIA NICOLAS', 'NICOLAS', 'NICOLÁS SEIA', '']) {
    assert.equal(detect([cli, { ...pig, name }]).length, 0)
  }
  assert.equal(detect([cli, { ...pig, name: '  nicolas   seia ' }]).length, 1)
  assert.equal(detect([{ ...cli, convertedFromAccount: '' }, pig]).length, 0)
  assert.equal(detect([{ ...cli, name: '' }, { ...pig, name: '' }]).length, 0)
  assert.equal(detect([cli, cli, pig]).length, 1)
  assert.equal(detect([cli, cli, pig])[0].clients.length, 1)
  assert.equal(detect([]).length, 0)
})
