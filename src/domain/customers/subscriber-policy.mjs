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
