const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const same = (a, b) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null))
function assertCollectionChange(before, after, authorized = false) {
  if (authorized) return
  const changedTrace = !same(before?.collection, after?.collection)
  const changedTerms = before?.collection && after && (Number(before.amount) !== Number(after.amount) || before.paymentMethod !== after.paymentMethod)
  if (changedTrace || changedTerms) throw Object.assign(new Error('Esta cobranza debe gestionarse desde Cobranzas para conservar su historial. No se guardaron los cambios.'), { statusCode: 409, code: 'COLLECTION_PROTECTED' })
}
function assertSharedCollection(root, record) {
  if (root?.collection && (Number(root.amount) !== Number(record.amount) || root.paymentMethod !== record.paymentMethod)) throw Object.assign(new Error('Las jornadas comparten una cobranza. Rectificá el monto o la forma de pago desde Cobranzas.'), { statusCode: 409, code: 'COLLECTION_PROTECTED' })
}
module.exports = { assertCollectionChange, assertSharedCollection }
