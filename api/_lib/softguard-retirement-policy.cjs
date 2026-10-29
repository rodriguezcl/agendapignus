const { isDeepStrictEqual } = require('node:util')
const { softguardRetirementPending } = require('./softguard-retirement.cjs')
const protectedKeys = ['convertedFromAccount', 'convertedFromType', 'subscriptionEndedAt', 'softguardRetirementResolution', 'softguardAddress']
const id = value => String(value ?? '')
const account = value => String(value || '').trim().toUpperCase()
const fail = message => { throw Object.assign(new Error(message), { statusCode: 403 }) }

function preserveSoftguardRetirementCustomers(current = [], proposed = [], { reject = false } = {}) {
  const byId = new Map(current.filter(row => id(row.customerId)).map(row => [id(row.customerId), row]))
  const byAccount = new Map(current.filter(row => account(row.account)).map(row => [account(row.account), row]))
  return proposed.map(row => {
    const previous = byId.get(id(row.customerId)) || byAccount.get(account(row.account))
    const next = { ...row }
    for (const key of protectedKeys) {
      if (reject && Object.hasOwn(row, key) && row[key] !== undefined && !isDeepStrictEqual(row[key], previous?.[key])) {
        fail('La procedencia, la verificación de domicilio y la gestión de la baja en SoftGuard sólo se modifican desde sus acciones específicas.')
      }
      delete next[key]
      if (previous && Object.hasOwn(previous, key)) next[key] = previous[key]
    }
    // Restoring a retired subscriber is done by the retirement service command,
    // after normal customer editing has passed this boundary.
    if (previous?.convertedFromAccount && previous?.subscriptionEndedAt) {
      if (reject && (account(row.account) !== account(previous.account) || row.kind && row.kind !== previous.kind)) {
        fail('Para restituir este abonado, corregí primero el retiro de equipo que originó la baja.')
      }
      next.account = previous.account
      next.kind = previous.kind
    }
    return next
  })
}

function protectSoftguardRetirementInput(incoming, current) {
  return Array.isArray(incoming.customers)
    ? { ...incoming, customers: preserveSoftguardRetirementCustomers(current.customers, incoming.customers, { reject: true }) }
    : incoming
}

function assertSoftguardRetirementDeletion(current, next) {
  const remaining = new Set((next.customers || []).map(row => id(row.customerId)))
  if ((current.customers || []).some(row => softguardRetirementPending(row) && !remaining.has(id(row.customerId)))) {
    fail('Registrá primero la baja realizada en SoftGuard antes de eliminar este cliente.')
  }
  return next
}

function assertSoftguardRetirementAccess(state, input, user) {
  if (!require('./permission-catalog.cjs').can(user, 'customers.softguard.resolve')) fail('No tenés permiso para registrar la baja en SoftGuard.')
  const customer = (state.customers || []).find(row => id(row.customerId) === id(input?.customerId))
  if (!customer) throw Object.assign(new Error('No se encontró el cliente.'), { statusCode: 404 })
  if (!require('./granular-read-policy.cjs').customerReadable(customer, user, state)) fail('El cliente está fuera del alcance de tu rol.')
}

module.exports = { preserveSoftguardRetirementCustomers, protectSoftguardRetirementInput, assertSoftguardRetirementDeletion, assertSoftguardRetirementAccess }
