const { isDeepStrictEqual } = require('node:util')

function customerKind(customer) {
  if (customer?.kind === 'subscriber' || customer?.kind === 'client') return customer.kind
  return String(customer?.account || '').toUpperCase().startsWith('PIG-') ? 'subscriber' : 'client'
}

function normalizeImportedCustomers(customers = []) {
  return customers.map(customer => ({
    ...customer,
    kind: customerKind(customer),
    name: String(customer?.name || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR')
  }))
}

function validateImportedCustomers(customers) {
  if (!Array.isArray(customers)) throw new Error('La importación no contiene una lista válida de abonados.')
  const unique = (key, label) => {
    const found = new Set()
    customers.forEach((customer, index) => {
      const value = String(customer?.[key] ?? '').trim().toLowerCase()
      if (!value) throw new Error(`${label} ${index + 1}: falta ${key}.`)
      if (found.has(value)) throw new Error('No puede haber clientes duplicados.')
      found.add(value)
    })
  }
  unique('account', 'Cliente')
  unique('customerId', 'Cliente')
}

const sameCustomer = (left, right) => isDeepStrictEqual(left, right)

function customerImportChanges(currentCustomers = [], nextCustomers = []) {
  const currentByAccount = new Map(currentCustomers.map(customer => [String(customer.account), customer]))
  const nextByAccount = new Map(nextCustomers.map(customer => [String(customer.account), customer]))
  const upsert = nextCustomers.filter(customer => {
    const current = currentByAccount.get(String(customer.account))
    return !current || !sameCustomer(current, customer)
  })
  const remove = currentCustomers.filter(customer => !nextByAccount.has(String(customer.account)))
  const before = [...upsert.map(customer => currentByAccount.get(String(customer.account))).filter(Boolean), ...remove]
  const createdAccounts = upsert.filter(customer => !currentByAccount.has(String(customer.account))).map(customer => String(customer.account))
  return { upsert, remove, backup: { version: 2, before, createdAccounts } }
}

function restoreCustomerImportBackup(currentCustomers = [], backup) {
  if (Array.isArray(backup?.customers)) return normalizeImportedCustomers(backup.customers)
  if (backup?.version !== 2 || !Array.isArray(backup.before) || !Array.isArray(backup.createdAccounts)) throw new Error('La copia de seguridad de la importación no es válida.')
  const created = new Set(backup.createdAccounts.map(String))
  const restoredByAccount = new Map(currentCustomers.filter(customer => !created.has(String(customer.account))).map(customer => [String(customer.account), customer]))
  normalizeImportedCustomers(backup.before).forEach(customer => restoredByAccount.set(String(customer.account), customer))
  return [...restoredByAccount.values()]
}

module.exports = { customerImportChanges, normalizeImportedCustomers, restoreCustomerImportBackup, validateImportedCustomers }
