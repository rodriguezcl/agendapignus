const normalizedAccount = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '')

const normalizeHeader = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]/g, '')
  .toLowerCase()

export const CUSTOMER_IMPORT_FIELDS = [
  ['Dealer/Cuenta', 'dealercuenta'],
  ['Nombre', 'nombre'],
  ['Tipo de Cuenta', 'tipodecuenta'],
  ['Calle', 'calle'],
  ['Localidad', 'localidad'],
  ['Provincia/Estado', 'provinciaestado'],
  ['Teléfono', 'telefono'],
  ['IMEI', 'imei'],
  ['Clave', 'clave'],
  ['Ubicación de la cuenta', 'ubicaciondelacuenta']
]

export function customerFromImportRow(headers = [], row = []) {
  const headerIndexes = new Map(headers.map((header, index) => [normalizeHeader(header), index]))
  const get = key => String(row[headerIndexes.get(key)] || '').trim()
  const account = normalizedAccount(get('dealercuenta'))
  if (!account) return null

  const street = get('calle')
  const locality = get('localidad')
  const requiredStreet = street || '-'
  return {
    customerId: '',
    kind: 'subscriber',
    account,
    name: get('nombre') || '-',
    type: get('tipodecuenta'),
    street: requiredStreet,
    locality,
    province: get('provinciaestado'),
    phone: get('telefono') || '-',
    address: [requiredStreet, locality].filter(Boolean).join(', '),
    fields: Object.fromEntries(CUSTOMER_IMPORT_FIELDS.map(([label, key]) => [label, get(key)]))
  }
}

const customerFingerprint = customer => JSON.stringify([
  customer.customerId,
  customer.kind,
  customer.account,
  customer.name,
  customer.type,
  customer.street,
  customer.locality,
  customer.province,
  customer.phone,
  customer.address,
  Object.entries(customer.fields || {}).sort(([left], [right]) => left.localeCompare(right))
])

export function mergeImportedCustomers(currentCustomers = [], importedCustomers = [], createCustomerId) {
  const existingByAccount = new Map(currentCustomers.map(customer => [normalizedAccount(customer.account), customer]))
  const importedKeys = new Set(importedCustomers.map(customer => normalizedAccount(customer.account)))
  const merged = importedCustomers.map(customer => {
    const previous = existingByAccount.get(normalizedAccount(customer.account))
    if (!previous) return { ...customer, customerId: customer.customerId || createCustomerId() }

    // El reporte no contiene CustomerId: la identidad interna siempre debe
    // conservarse al actualizar una cuenta ya existente.
    const next = { ...previous, ...customer, customerId: previous.customerId || createCustomerId() }
    ;['name', 'type', 'street', 'locality', 'province', 'phone'].forEach(field => {
      if (!customer[field] || customer[field] === '-') next[field] = previous[field] || customer[field] || ''
    })
    next.address = [next.street, next.locality].filter(Boolean).join(', ') || '-'
    // El detalle importado es una lista cerrada. Reemplazarlo evita conservar
    // columnas residuales de reportes anteriores dentro del abonado.
    next.fields = { ...(customer.fields || {}) }
    return next
  })

  const updated = merged.filter(customer => {
    const previous = existingByAccount.get(normalizedAccount(customer.account))
    return previous && customerFingerprint(previous) !== customerFingerprint(customer)
  }).length

  return {
    customers: [...currentCustomers.filter(customer => !importedKeys.has(normalizedAccount(customer.account))), ...merged],
    created: merged.filter(customer => !existingByAccount.has(normalizedAccount(customer.account))).length,
    updated
  }
}
