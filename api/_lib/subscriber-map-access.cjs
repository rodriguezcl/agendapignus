// A role granted only Map receives location data, never passwords or account keys.
function mapCustomer(customer) {
  const keys = ['customerId', 'kind', 'account', 'name', 'type', 'status', 'subscriptionEndedAt', 'street', 'locality', 'province', 'address', 'installationZone', 'locationOverride']
  return {
    ...Object.fromEntries(keys.filter(key => Object.hasOwn(customer, key)).map(key => [key, customer[key]])),
    fields: Object.fromEntries(['Ubicación de la cuenta', 'Calle', 'Localidad', 'Provincia/Estado'].filter(key => Object.hasOwn(customer.fields || {}, key)).map(key => [key, customer.fields[key]]))
  }
}
module.exports = { mapCustomer }
