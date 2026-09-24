const test = require('node:test')
const assert = require('node:assert/strict')
const { retirementClientLabel: reportLabel } = require('../api/_lib/retirement-label.cjs')

test('listado y reportes muestran el CLI asignado conservando el nombre histórico', async () => {
  const { retirementClientLabel: displayLabel } = await import('../src/domain/customers/retirement-label.mjs')
  for (const [old, current, name] of [
    ['PIG-6703', 'CLI-0135', 'GONZALO DE MORA'],
    ['PIG-6652', 'CLI-0137', 'CARLOS RODOLFO GIOBELLINA'],
    ['PIG-6686', 'CLI-0136', 'GABRIELA SANCHEZ']
  ]) {
    const record = { client: `${old} ${name}`, clientAccount: current, clientNameAtService: 'Otro nombre que no debe reemplazar al visible' }
    const before = structuredClone(record)
    assert.equal(displayLabel(record), `${current} ${name}`)
    assert.equal(reportLabel(record), displayLabel(record))
    assert.deepEqual(record, before)
  }
})

test('no inventa códigos CLI ni altera etiquetas correctas o nombres con guiones', async () => {
  const { retirementClientLabel: displayLabel } = await import('../src/domain/customers/retirement-label.mjs')
  for (const [record, expected] of [
    [{ client: 'CLI-0155 SHANK BOX - NICOLAS SPITALE', clientAccount: 'CLI-0155' }, 'CLI-0155 SHANK BOX - NICOLAS SPITALE'],
    [{ client: 'PIG-123 Nombre sin cuenta CLI asignada' }, 'PIG-123 Nombre sin cuenta CLI asignada'],
    [{ clientAccount: 'CLI-0020', clientNameAtService: 'Nombre registrado' }, 'CLI-0020 Nombre registrado'],
    [{ client: 'Nombre registrado', clientAccount: 'CLI-0020' }, 'CLI-0020 Nombre registrado']
  ]) {
    assert.equal(displayLabel(record), expected)
    assert.equal(reportLabel(record), expected)
  }
})
