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

function preserveCustomerTrackingFlags(currentCustomers = [], importedCustomers = []) {
  const byId = new Map(currentCustomers.map(customer => [String(customer?.customerId || ''), customer]))
  const byAccount = new Map(currentCustomers.map(customer => [String(customer?.account || '').trim().toUpperCase(), customer]))
  return importedCustomers.map(customer => {
    const current = byId.get(String(customer?.customerId || '')) || byAccount.get(String(customer?.account || '').trim().toUpperCase())
    return { ...customer, cctvService: Boolean(current?.cctvService) }
  })
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

function validateIncrementalCustomerImport(currentCustomers = [], nextCustomers = []) {
  const nextAccounts = new Set(nextCustomers.map(customer => String(customer?.account || '').trim().toUpperCase()))
  const missing = currentCustomers.filter(customer => !nextAccounts.has(String(customer?.account || '').trim().toUpperCase()))
  if (missing.length) {
    const error = new Error(`La importación no puede eliminar abonados ni clientes existentes (${missing.length} registro(s) ausente(s)). Recargá la página y volvé a seleccionar el archivo.`)
    error.statusCode = 409
    throw error
  }
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

module.exports = { customerImportChanges, normalizeImportedCustomers, preserveCustomerTrackingFlags, restoreCustomerImportBackup, validateImportedCustomers, validateIncrementalCustomerImport }
