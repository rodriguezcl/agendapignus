const text = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const name = value => text(value).split(' ').filter(Boolean).sort().join(' ')
const phone = value => {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('0054')) digits = digits.slice(4)
  else if (digits.startsWith('54') && digits.length > 10) digits = digits.slice(2)
  if (digits.startsWith('9') && digits.length === 11) digits = digits.slice(1)
  if (digits.startsWith('0') && digits.length > 10) digits = digits.slice(1)
  if (digits.length === 12) digits = digits.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2')
  return digits.length >= 10 ? digits : ''
}
const address = value => text(value).replace(/\bavenida\b/g, 'av').replace(/\bbarrio\b/g, 'b').replace(/\bnumero\b/g, '').replace(/\s+/g, ' ').trim()

function matchesRetiredSubscriber(client, subscriber) {
  const leftName = name(client.name), rightName = name(subscriber.name)
  if (leftName.length < 5 || leftName !== rightName) return false
  const leftPhone = phone(client.phone), rightPhone = phone(subscriber.phone)
  const phoneMatch = Boolean(leftPhone && leftPhone === rightPhone)
  const addressMatch = ['street', 'address'].some(key => {
    const left = address(client[key]), right = address(subscriber[key])
    return left.length >= 8 && /\d/.test(left) && /[a-z]/.test(left) && left === right
  })
  return phoneMatch || addressMatch
}

function mergeRetiredSubscriber(client, subscriber) {
  const merged = { ...client, ...subscriber, kind: 'subscriber' }
  for (const key of ['name', 'phone', 'street', 'address', 'locality', 'province', 'type']) {
    if (!text(subscriber[key])) merged[key] = client[key]
  }
  merged.type = subscriber.type || client.convertedFromType || 'Abonado'
  merged.fields = { ...(client.fields || {}), ...(subscriber.fields || {}) }
  merged.cctvService = Boolean(client.cctvService || subscriber.cctvService)
  // Preserve the complete CLI snapshot, including conflicting optional data.
  // The existing PIG remains the canonical identity for imports and references.
  merged.mergedRetirementCustomers = [...(subscriber.mergedRetirementCustomers || []), structuredClone(client)]
  delete merged.convertedFromAccount
  delete merged.convertedFromType
  delete merged.subscriptionEndedAt
  return merged
}

module.exports = { matchesRetiredSubscriber, mergeRetiredSubscriber }
