const policy = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')

function setSupervisorContact(state, user, command) {
  const fail = (message, statusCode) => { const error = new Error(message); error.statusCode = statusCode; throw error }
  const supervisor = policy.isGranular(user)
    ? policy.readScope(user, 'services') === 'cctv' && policy.can(user, 'history.view') && policy.can(user, 'records.read')
    : policy.roleCode(user) === 'supervisor'
  if (!supervisor) fail('No tenés permiso para registrar el contacto de supervisión.', 403)
  if (!command || typeof command.contactedOk !== 'boolean' || !command.recordId || Object.keys(command).some(key => !['recordId', 'contactedOk'].includes(key))) fail('El contacto solicitado no es válido.', 400)
  const current = state.history.find(record => String(record.id) === String(command.recordId))
  if (!current || read.customerForRecord(current, state)?.cctvService !== true || (policy.isGranular(user) && !read.serviceReadable(current, user, state))) fail('El servicio no está disponible para supervisión.', 403)
  // Only this flag changes; technical data, status and hidden fields are preserved.
  const next = { ...current, contactedOk: command.contactedOk }
  return { current, next, state: { ...state, history: state.history.map(record => record === current ? next : record) } }
}
module.exports = { setSupervisorContact }
