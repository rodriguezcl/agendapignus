const requirements = require('../../shared/cctv-requirements.json')
const { assertCctvAccess } = require('./cctv-access.cjs')

const validDetail = detail => typeof detail === 'string' && detail.length <= 1000

function validateCctvRequirementDetail(customer) {
  const detail = customer.cctvRequirementDetail
  if (detail != null && (!validDetail(detail) || (detail && (customer.cctvService !== true || customer.cctvRequirement !== 'Otro')))) {
    throw new Error('Detalle del requerimiento de CCTV inválido.')
  }
}

function applyCctvRequirement(state, input, user) {
  const before = assertCctvAccess(user, state, input?.customerId, { write: true })
  const { expectedRequirement, cctvRequirement } = input
  if (typeof expectedRequirement !== 'string' || (cctvRequirement !== '' && !requirements.includes(cctvRequirement))) {
    throw Object.assign(new Error('Indicá el requerimiento anterior y seleccioná una opción válida.'), { statusCode: 400 })
  }
  const previous = before.cctvRequirement || ''
  const previousDetail = previous === 'Otro' ? (before.cctvRequirementDetail || '') : ''
  const { expectedDetail = '', cctvRequirementDetail = previousDetail } = input
  if (typeof expectedDetail !== 'string' || !validDetail(cctvRequirementDetail)) {
    throw Object.assign(new Error('El detalle del requerimiento debe tener hasta 1000 caracteres.'), { statusCode: 400 })
  }
  const detail = cctvRequirement === 'Otro' ? cctvRequirementDetail.trim() : ''
  if (previous === cctvRequirement && previousDetail === detail) return { before, after: before, state }
  if (previous !== expectedRequirement || previousDetail !== expectedDetail) {
    throw Object.assign(new Error('El requerimiento cambió desde otra sesión. Revisá el valor actual antes de guardar.'), { statusCode: 409, code: 'CCTV_REQUIREMENT_CONFLICT' })
  }
  const after = { ...before, cctvRequirement }
  if (detail) after.cctvRequirementDetail = detail
  else delete after.cctvRequirementDetail
  return { before, after, state: { ...state, customers: state.customers.map(customer => customer === before ? after : customer) } }
}

module.exports = { applyCctvRequirement, validateCctvRequirementDetail }
