import policy from '../../../api/_lib/permission-catalog.cjs'

const id = value => String(value ?? '')
const account = value => String(value || '').trim().toUpperCase()

const accountForRecord = record => account(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0])

function findCustomer(record, customers) {
  return (record.customerId && customers.find(item => id(item.customerId) === id(record.customerId))) ||
    customers.find(item => account(item.account) && account(item.account) === accountForRecord(record))
}

function matchesRecordScope(scope, record, user, customers, lookup = findCustomer) {
  if (!record || !user) return false
  if (scope === 'all') return true
  if (scope === 'assigned') return user.id != null && (record.technicianIds || []).some(value => id(value) === id(user.id))
  if (scope !== 'cctv') return false
  const customer = lookup(record, customers)
  return customer ? customer.cctvService === true : record.supervisorVisible === true
}

// These helpers constrain visible actions; the server revalidates the same
// scope using current assignment and customer data before persisting.
export function canReadRecord(record, user, customers = []) {
  if (!policy.isGranular(user)) return true
  return matchesRecordScope(policy.readScope(user, 'services'), record, user, customers)
}

// Resolve the scope once when filtering a whole history. As with Array.find,
// the first matching account wins if an older import contains duplicates.
export function createRecordReadFilter(user, customers = []) {
  if (!policy.isGranular(user)) return () => true
  const scope = policy.readScope(user, 'services')
  if (scope !== 'cctv') return record => matchesRecordScope(scope, record, user, customers)
  const byId = new Map(), byAccount = new Map()
  for (const customer of customers) {
    const customerId = id(customer.customerId), key = account(customer.account)
    if (customerId && !byId.has(customerId)) byId.set(customerId, customer)
    if (key && !byAccount.has(key)) byAccount.set(key, customer)
  }
  const lookup = record => (record.customerId && byId.get(id(record.customerId))) || byAccount.get(accountForRecord(record))
  return record => matchesRecordScope(scope, record, user, customers, lookup)
}

export function canWriteRecord(record, user, customers = []) {
  if (!policy.isGranular(user)) return true
  return canReadRecord(record, user, customers) && matchesRecordScope(policy.writeScope(user, 'services'), record, user, customers)
}
