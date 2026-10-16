const test = require('node:test')
const assert = require('node:assert/strict')

test('collection amounts accept both decimal keys and pasted Argentine display without changing their value', async () => {
  const { parseCollectionAmount, displayCollectionAmount } = await import('../src/domain/collections/collection-amount.mjs')
  for (const [input, expected] of [['626376', '626376'], ['626376,50', '626376.5'], ['626376.50', '626376.5'], ['626.376,50', '626376.5'], ['15.000,00', '15000'], ['1.234.567,89', '1234567.89'], [',50', '0.5'], ['.50', '0.5'], ['0,01', '0.01'], ['12,', '12'], [' 0012.50 ', '12.5'], ['999999999.99', '999999999.99']]) {
    assert.equal(parseCollectionAmount(input), expected, input)
    assert.equal(parseCollectionAmount(displayCollectionAmount(input)), expected, input)
  }
  assert.equal(displayCollectionAmount('626376'), '626.376,00')
  assert.equal(displayCollectionAmount('626376.5'), '626.376,50')
})

test('invalid monetary values are rejected and stay visible without truncation or silent conversion', async () => {
  const { parseCollectionAmount, displayCollectionAmount } = await import('../src/domain/collections/collection-amount.mjs')
  for (const input of ['', '0', '-150', 'NaN', 'Infinity', '1e3', '1.234', '12,345', '12.34.56', '1,234.56', '1,2,3', '1.23,45', 'abc150', '1000000000', '999999999,999']) {
    assert.equal(parseCollectionAmount(input), null, input)
    assert.equal(displayCollectionAmount(input), input)
  }
})
