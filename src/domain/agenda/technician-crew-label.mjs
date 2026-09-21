export function technicianCrewLabel(record, userId) {
  const ids = record.technicianIds || []
  const names = record.technicians || []
  if (!ids.some(id => String(id) === String(userId))) return 'Asignación de compañeros no disponible'
  const companions = [...new Set(ids.map(String))].filter(id => id !== String(userId))
  if (!companions.length) return 'Vas solo'
  return `Compartís equipo con ${companions.map(id => names[ids.findIndex(value => String(value) === id)] || 'un técnico (nombre no disponible)').join(' y ')}`
}
