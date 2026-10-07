export function serviceMapCustomer(record, customers = []) {
  if (!record || record.vehicleControl || record.subscriberReservation || record.newCustomer) return null
  const account = String(record.clientAccount || record.account || String(record.client || '').trim().split(/\s+/)[0]).trim().toUpperCase()
  const customer = record.customerId
    ? customers.find(item => String(item.customerId) === String(record.customerId))
    : customers.find(item => String(item.account || '').trim().toUpperCase() === account)
  return customer && /^PIG-\d+$/i.test(customer.account || '') ? customer : null
}
