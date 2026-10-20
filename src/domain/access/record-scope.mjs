import policy from '../../../api/_lib/permission-catalog.cjs'

const id = value => String(value ?? '')
const account = value => String(value || '').trim().toUpperCase()

function matchesRecordScope(scope, record, user, customers) {
  if (!record || !user) return false
  if (scope === 'all') return true
  if (scope === 'assigned') return user.id != null && (record.technicianIds || []).some(value => id(value) === id(user.id))
  if (scope !== 'cctv') return false
  const customer = customers.find(item =>
    (record.customerId && id(item.customerId) === id(record.customerId)) ||
    (account(item.account) && account(item.account) === account(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0])))
  return customer ? customer.cctvService === true : record.supervisorVisible === true
}

// These helpers constrain visible actions; the server revalidates the same
// scope using current assignment and customer data before persisting.
export function canReadRecord(record, user, customers = []) {
  if (!policy.isGranular(user)) return true
  return matchesRecordScope(policy.readScope(user, 'services'), record, user, customers)
}

export function canWriteRecord(record, user, customers = []) {
  if (!policy.isGranular(user)) return true
  return canReadRecord(record, user, customers) && matchesRecordScope(policy.writeScope(user, 'services'), record, user, customers)
}
