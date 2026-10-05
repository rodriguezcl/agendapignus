function validateServiceTypes(state) {
  const catalog = new Map((state.services || []).map(item => [String(item.id), item]))
  const check = item => {
    if (item.serviceTypes == null) return
    if (!Array.isArray(item.serviceTypes) || !item.serviceTypes.length) throw new Error('Seleccioná al menos un tipo de servicio.')
    const ids = item.serviceTypes.map(type => String(type?.id))
    if (new Set(ids).size !== ids.length || ids.some(id => !catalog.has(id))) throw new Error('La selección contiene tipos de servicio duplicados o inexistentes.')
    if (String(item.serviceId) !== ids[0]) throw new Error('Los tipos de servicio no coinciden con la referencia del servicio.')
    if (item.vehicleControl && ids.length > 1) throw new Error('El control vehicular se gestiona por separado.')
  }
  ;(state.history || []).forEach(check)
  const plans = [state.agenda, ...Object.entries(state.agenda?.weekly || {}).filter(([key]) => !key.startsWith('_')).map(([, plan]) => plan)]
  plans.forEach(plan => (plan?.teams || []).forEach(team => (team.tasks || []).forEach(check)))
  return state
}
module.exports = { validateServiceTypes }
