// Resolve only linked customer data; never infer a neighborhood from an address.
export function reservationLocality(record, customers = []) {
  const linked = createServiceLocalityLookup(customers)(record)
  if (linked) return linked
  const explicit = String(record?.locality || '').trim()
  if (explicit) return explicit.toLocaleUpperCase('es-AR')
  return ({ docta: 'DOCTA URBANIZACIÓN', 'nobu-town': 'NOBU TOWN' })[record?.installationZone] || 'Barrio sin especificar'
}

export function createServiceLocalityLookup(customers = []) {
  const byId = new Map()
  const byAccount = new Map()
  const accountKey = value => String(value || '').trim().toUpperCase()
  for (const customer of customers) {
    if (customer.customerId) byId.set(String(customer.customerId), customer)
    if (customer.account) byAccount.set(accountKey(customer.account), customer)
  }
  return task => {
    if (!task || task.vehicleControl) return ''
    const account = accountKey(task.clientAccount || String(task.client || '').trim().split(/\s+/)[0])
    const customer = task.customerId
      ? byId.get(String(task.customerId))
      : byAccount.get(account)
    return String(customer?.locality || '').trim().toLocaleUpperCase('es-AR')
  }
}
