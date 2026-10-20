function canPerformTechnicalServices(user) {
  const permissions = require('./permission-catalog.cjs')
  if (permissions.isGranular(user)) return permissions.can(user, 'technical.view') && (permissions.roleCode(user) === 'technician' || user?.technicalEnabled === true)
  return !require('./operator-access.cjs').isOperator(user) && (user?.roleCode === 'technician' || (user?.roleCode !== 'supervisor' && user?.technicalEnabled === true))
}
module.exports = { canPerformTechnicalServices }
