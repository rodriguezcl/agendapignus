// Ampliación aditiva: conservar las reglas, nombres y desactivaciones del administrador.
function initializeBusinessDefaults(config, defaults) {
  const result = JSON.parse(JSON.stringify(config))
  for (const id of ['commercial', 'administrative']) {
    const seed = defaults.categories.find(item => item.id === id)
    const existing = result.categories.find(item => item.id === id || item.name.toLocaleLowerCase('es') === seed.name.toLocaleLowerCase('es'))
    if (existing) {
      if (existing.active === false) continue
      for (const child of seed.subcategories) {
        if (existing.subcategories.length < 100 && !existing.subcategories.some(item => item.id === child.id || item.name.toLocaleLowerCase('es') === child.name.toLocaleLowerCase('es'))) existing.subcategories.push({ ...child })
      }
    } else if (result.categories.length < 100) {
      const category = JSON.parse(JSON.stringify(seed))
      if (!result.areas.some(area => area.id === category.areaId && area.active !== false)) category.areaId = ''
      result.categories.push(category)
    }
  }
  return result
}
module.exports = { initializeBusinessDefaults }
