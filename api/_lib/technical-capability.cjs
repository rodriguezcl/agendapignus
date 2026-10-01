function canPerformTechnicalServices(user) {
  return !require('./operator-access.cjs').isOperator(user) && (user?.roleCode === 'technician' || (user?.roleCode !== 'supervisor' && user?.technicalEnabled === true))
}
module.exports = { canPerformTechnicalServices }
