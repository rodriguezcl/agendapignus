import { isNobuTown } from './nobu-town-location.mjs'
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

// Explicit choices survive imports. Legacy accounts are classified by title.
export function excludedFromSubscriberCount(customer) {
  return typeof customer?.excludeFromSubscriberCount === 'boolean'
    ? customer.excludeFromSubscriberCount
    : /\bauto[\s-]*monitoreo\b/.test(normalized(customer?.name))
}

export function isActiveSubscriber(customer) {
  const account = normalized(customer?.account).replace(/\s/g, '')
  return customer?.kind !== 'client' && (customer?.kind === 'subscriber' || account.startsWith('pig-'))
    && !customer.subscriptionEndedAt && !['inactivo', 'baja', 'cancelado'].includes(normalized(customer.status))
    && !excludedFromSubscriberCount(customer)
}

export function activeSubscribers(customers = []) {
  const accounts = new Set(), ids = new Set()
  return customers.filter(customer => {
    const account = normalized(customer.account).replace(/\s/g, '')
    const id = String(customer.customerId || '')
    if (!isActiveSubscriber(customer) || (!account && !id) || (account && accounts.has(account)) || (id && ids.has(id))) return false
    if (account) accounts.add(account)
    if (id) ids.add(id)
    return true
  })
}

export function subscriberZone(customer) {
  const context = normalized([customer.address, customer.street, customer.locality, customer.name, customer.fields?.Localidad].join(' '))
  return isNobuTown(customer) ? 'nobu-town' : context.includes('docta') ? 'docta' : 'residencial'
}
