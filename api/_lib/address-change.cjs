const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const ADDRESS_CHANGE_SERVICE = Object.freeze({ id: 'address-change', code: 'address-change', name: 'Cambio de domicilio', category: 'service', description: 'Retiro del equipo en el domicilio actual e instalación en el nuevo, conservando el abonado.', estimatedMinutes: 120, status: 'Activo' })
const isType = type => type?.code === 'address-change' || type?.id === 'address-change' || type?.serviceId === 'address-change' || normalize(type?.name || type?.service) === 'cambio de domicilio'
const isAddressChange = record => isType(record) || (record?.serviceTypes || []).some(isType) || (record?.workCompletion?.items || []).some(isType)

function ensureAddressChangeService(services = []) {
  return services.some(isType) ? services : [...services, { ...ADDRESS_CHANGE_SERVICE }]
}

function validateAddressChange(record) {
  if (!isAddressChange(record) || record.status === 'Cancelado') return
  if (!record.customerId || record.subscriberReservation) throw new Error('Cambio de domicilio requiere un abonado o cliente existente.')
  for (const [key, label] of [['address', 'Domicilio actual'], ['newAddress', 'Domicilio nuevo']]) {
    if (typeof record[key] !== 'string' || !record[key].trim() || record[key].length > 1000) throw new Error(`${label}: ingresá una dirección válida de hasta 1000 caracteres.`)
  }
  if (normalize(record.address) === normalize(record.newAddress)) throw new Error('El domicilio nuevo debe ser distinto del domicilio actual.')
}

function changeCompleted(record) {
  if (record.status !== 'Completado' && !record.journeyClosedAt) return false
  const item = record.workCompletion?.items?.find(isType)
  return !item || item.status === 'completed'
}

function addressChangeState(record, customer) {
  if (!isAddressChange(record) || ['Cancelado', 'Reprogramado'].includes(record.status)) return null
  // Once administration manages an unperformed category, any new visit owns
  // its own reminder. The closed visit must not keep an orphan planned notice.
  if (record.workCompletion?.management && record.workCompletion.items?.some(item => isType(item) && item.status === 'pending')) return null
  if (!changeCompleted(record)) return { status: 'planned' }
  const snapshot = customer?.softguardAddress
  const completedAt = record.completedAt || record.journeyClosedAt || record.technicalReportedAt
  if (!snapshot?.checkedAt || !completedAt || !(Date.parse(snapshot.checkedAt) >= Date.parse(completedAt))) return { status: 'awaiting-sync' }
  const expected = normalize(record.newAddress), received = normalize(snapshot.address)
  if (expected && received === expected) return { status: 'verified', ...snapshot }
  return { status: received === normalize(record.address) ? 'unchanged' : 'different', ...snapshot }
}

function pendingAddressChanges(history = [], customers = []) {
  const byId = new Map(customers.map(customer => [String(customer.customerId), customer]))
  const groups = new Map()
  for (const record of history.filter(isAddressChange)) {
    if (['Cancelado', 'Reprogramado'].includes(record.status)) continue
    const key = record.serviceJourney?.id || record.id
    const previous = groups.get(key)
    if (!previous || (changeCompleted(record) && !changeCompleted(previous)) || changeCompleted(record) === changeCompleted(previous) && String(record.date) > String(previous.date)) groups.set(key, record)
  }
  const records = [...groups.values()]
  return records.flatMap(record => {
    // A later completed move supersedes the old address requirement for this account.
    if (changeCompleted(record) && records.some(other => other !== record && String(other.customerId) === String(record.customerId) && changeCompleted(other) && String(other.completedAt || other.date) > String(record.completedAt || record.date))) return []
    const verification = addressChangeState(record, byId.get(String(record.customerId)))
    return verification && verification.status !== 'verified' ? [{ record, verification }] : []
  })
}

// Only the import endpoint creates this evidence. Manual edits cannot confirm SoftGuard.
function captureImportedAddresses(customers, importedAccounts, now = new Date().toISOString(), history = []) {
  if (!Array.isArray(importedAccounts)) return customers
  const accounts = new Set(importedAccounts.map(value => String(value).trim().toUpperCase()))
  const tracked = new Set(history.filter(isAddressChange).filter(record => record.status !== 'Cancelado').map(record => String(record.customerId)))
  return customers.map(customer => {
    if (!tracked.has(String(customer.customerId))) return customer
    if (!accounts.has(String(customer.account).trim().toUpperCase())) return customer
    const street = customer.fields?.Calle, locality = customer.fields?.Localidad
    if (!String(street || '').trim() || street === '-') return customer
    return { ...customer, softguardAddress: { address: [street, locality].filter(Boolean).join(', '), checkedAt: now } }
  })
}

module.exports = { ADDRESS_CHANGE_SERVICE, isAddressChange, ensureAddressChangeService, validateAddressChange, changeCompleted, addressChangeState, pendingAddressChanges, captureImportedAddresses }
