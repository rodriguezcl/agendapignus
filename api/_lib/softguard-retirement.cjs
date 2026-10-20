// Shared by browser and server. This module intentionally has no Node imports.
const SOFTGUARD_RETIREMENT_START = '2026-10-20T03:00:00.000Z'
const cutoff = Date.parse(SOFTGUARD_RETIREMENT_START)
const account = value => String(value || '').trim().toUpperCase()
const id = value => String(value ?? '')
const timestamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN

function retirementToken(customer) {
  return { convertedFromAccount: account(customer?.convertedFromAccount), subscriptionEndedAt: String(customer?.subscriptionEndedAt || '') }
}

function softguardRetirementResolution(customer) {
  const token = retirementToken(customer)
  const resolution = customer?.softguardRetirementResolution
  return resolution && account(resolution.convertedFromAccount) === token.convertedFromAccount &&
    resolution.subscriptionEndedAt === token.subscriptionEndedAt && Number.isFinite(timestamp(resolution.completedAt)) && id(resolution.completedBy)
    ? resolution : null
}

function softguardRetirementPending(customer) {
  if (!customer || (customer.kind && customer.kind !== 'client') || !/^CLI-\d+$/i.test(account(customer.account))) return false
  const token = retirementToken(customer)
  if (!/^PIG-\d+$/i.test(token.convertedFromAccount) || !(timestamp(token.subscriptionEndedAt) >= cutoff)) return false
  return !softguardRetirementResolution(customer)
}

function pendingSoftguardRetirements(customers = []) {
  return customers.filter(softguardRetirementPending).sort((left, right) =>
    timestamp(right.subscriptionEndedAt) - timestamp(left.subscriptionEndedAt) || id(left.customerId).localeCompare(id(right.customerId)))
}

function softguardRetirementBase(customer) {
  return {
    customerId: id(customer?.customerId), account: account(customer?.account), kind: customer?.kind || '',
    ...retirementToken(customer), resolution: customer?.softguardRetirementResolution || null
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}

function resolveSoftguardRetirement(state, input, user, now = new Date().toISOString()) {
  const before = (state.customers || []).find(customer => id(customer.customerId) === id(input?.customerId))
  if (!before) throw Object.assign(new Error('No se encontró el cliente.'), { statusCode: 404 })
  if (!input?.base || JSON.stringify(stable(input.base)) !== JSON.stringify(stable(softguardRetirementBase(before)))) {
    throw Object.assign(new Error('La baja cambió en otra sesión. Actualizá los datos antes de confirmar.'), { statusCode: 409 })
  }
  if (!softguardRetirementPending(before)) throw Object.assign(new Error('Esta baja no tiene una gestión pendiente en SoftGuard.'), { statusCode: 409 })
  if (!id(user?.id) || !Number.isFinite(timestamp(now))) throw Object.assign(new Error('No se pudo identificar la confirmación de la baja.'), { statusCode: 400 })
  const after = { ...before, softguardRetirementResolution: {
    ...retirementToken(before), completedAt: now, completedBy: user.id, completedByName: String(user.name || '')
  } }
  return { before, after, state: { ...state, customers: state.customers.map(customer => customer === before ? after : customer) } }
}

module.exports = { SOFTGUARD_RETIREMENT_START, pendingSoftguardRetirements, softguardRetirementPending, softguardRetirementResolution, softguardRetirementBase, resolveSoftguardRetirement }
