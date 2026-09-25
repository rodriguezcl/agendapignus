function canPerformTechnicalServices(user) {
  return user?.roleCode === 'technician' || (user?.roleCode !== 'supervisor' && user?.technicalEnabled === true)
}
module.exports = { canPerformTechnicalServices }
