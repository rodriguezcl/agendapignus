const normalizedAccount = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '')

export function mergeImportedCustomers(currentCustomers = [], importedCustomers = [], createCustomerId) {
  const existingByAccount = new Map(currentCustomers.map(customer => [normalizedAccount(customer.account), customer]))
  const importedKeys = new Set(importedCustomers.map(customer => normalizedAccount(customer.account)))
  const updated = importedCustomers.filter(customer => existingByAccount.has(normalizedAccount(customer.account))).length
  const merged = importedCustomers.map(customer => {
    const previous = existingByAccount.get(normalizedAccount(customer.account))
    if (!previous) return { ...customer, customerId: customer.customerId || createCustomerId() }

    // El reporte no contiene CustomerId: la identidad interna siempre debe
    // conservarse al actualizar una cuenta ya existente.
    const next = { ...previous, ...customer, customerId: previous.customerId || createCustomerId() }
    ;['name', 'type', 'street', 'locality', 'province', 'phone'].forEach(field => {
      if (!customer[field] || customer[field] === '-') next[field] = previous[field] || customer[field] || ''
    })
    next.address = [next.street, next.locality, next.province].filter(Boolean).join(', ') || '-'
    next.fields = { ...(previous.fields || {}), ...(customer.fields || {}) }
    return next
  })

  return {
    customers: [...currentCustomers.filter(customer => !importedKeys.has(normalizedAccount(customer.account))), ...merged],
    created: importedCustomers.length - updated,
    updated
  }
}
