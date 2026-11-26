const requirements = require('../../shared/cctv-requirements.json')
const { assertCctvAccess } = require('./cctv-access.cjs')

function applyCctvRequirement(state, input, user) {
  const before = assertCctvAccess(user, state, input?.customerId, { write: true })
  const { expectedRequirement, cctvRequirement } = input
  if (typeof expectedRequirement !== 'string' || (cctvRequirement !== '' && !requirements.includes(cctvRequirement))) {
    throw Object.assign(new Error('Indicá el requerimiento anterior y seleccioná una opción válida.'), { statusCode: 400 })
  }
  const previous = before.cctvRequirement || ''
  if (previous === cctvRequirement) return { before, after: before, state }
  if (previous !== expectedRequirement) {
    throw Object.assign(new Error('El requerimiento cambió desde otra sesión. Revisá el valor actual antes de guardar.'), { statusCode: 409, code: 'CCTV_REQUIREMENT_CONFLICT' })
  }
  const after = { ...before, cctvRequirement }
  return { before, after, state: { ...state, customers: state.customers.map(customer => customer === before ? after : customer) } }
}

module.exports = { applyCctvRequirement }
