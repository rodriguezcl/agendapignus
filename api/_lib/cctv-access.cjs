const policy = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')
const sameId = (a, b) => a != null && b != null && String(a) === String(b)
const fail = (message, statusCode = 403) => { throw Object.assign(new Error(message), { statusCode }) }
function activeActor(user, state) {
  if (user?.id == null || user.status === 'Inactivo') return false
  const employee = (state.employees || []).find(item => sameId(item.id, user.id))
  return !employee || employee.status === 'Activo'
}
function customerAllowed(user, state, customer) {
  if (!customer || customer.cctvService !== true || !activeActor(user, state) || !policy.can(user, 'cctv.view')) return false
  if (!read.customerReadable(customer, user, state)) return false
  if (policy.roleCode(user) !== 'technician') return true
  return (state.history || []).some(record => record.awaitingConfirmation !== true && (record.technicianIds || []).some(id => sameId(id, user.id)) &&
    read.customerForRecord(record, state) === customer && read.serviceReadable(record, user, state))
}
function listCctvCustomers(user, state = {}) {
  if (!activeActor(user, state) || !policy.can(user, 'cctv.view')) fail('No tenés permiso para consultar Servicios de CCTV.')
  return (state.customers || []).filter(customer => customerAllowed(user, state, customer))
}
function assertCctvAccess(user, state = {}, customerId, { write = false, download = false } = {}) {
  const customer = (state.customers || []).find(item => sameId(item.customerId, customerId))
  if (!customerAllowed(user, state, customer)) fail('La cuenta no está disponible para consultar Servicios de CCTV.', 404)
  if (write && (policy.roleCode(user) === 'technician' || !policy.can(user, 'cctv.edit'))) fail('No tenés permiso para modificar la ficha de CCTV.')
  if (download && !policy.can(user, 'cctv.download')) fail('No tenés permiso para descargar documentos de CCTV.')
  return customer
}
function cctvCapabilities(user) {
  return { edit: policy.roleCode(user) !== 'technician' && policy.can(user, 'cctv.edit'), download: policy.can(user, 'cctv.download') }
}
function presentCctvCustomer(customer, user) {
  const result = { customerId: customer.customerId, account: customer.account, name: customer.name, cctvService: true, cctvRequirement: customer.cctvRequirement || '', type: customer.type || '', kind: customer.kind || '' }
  if (result.cctvRequirement === 'Otro' && customer.cctvRequirementDetail) result.cctvRequirementDetail = customer.cctvRequirementDetail
  if (policy.can(user, 'records.contact')) for (const key of ['address', 'street', 'locality', 'province', 'phone', 'email', 'contact', 'contactName', 'contactPhone']) {
    if (typeof customer[key] === 'string') result[key] = customer[key]
  }
  return result
}
module.exports = { assertCctvAccess, listCctvCustomers, cctvCapabilities, presentCctvCustomer }
