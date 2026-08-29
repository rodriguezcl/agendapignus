const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))

const sameSnapshot = (left, right) => JSON.stringify(left || []) === JSON.stringify(right || [])

export function teamConfigurationSnapshot(teams) {
  return (teams || []).map((team, index) => ({
    teamId: team.teamId || '',
    label: team.label || `Equipo ${index + 1}`,
    technicianIds: [...(team.memberIds || [])],
    technicians: [...(team.members || [])]
  }))
}

export function vehicleConfigurationSnapshot(assignments, vehicles, technicians) {
  const vehicleById = new Map((vehicles || []).map(vehicle => [String(vehicle.id), vehicle]))
  const technicianById = new Map((technicians || []).map(technician => [String(technician.id), technician]))
  return (assignments || []).map(assignment => {
    const vehicle = vehicleById.get(String(assignment.vehicleId))
    const technician = technicianById.get(String(assignment.technicianId))
    return {
      vehicleId: assignment.vehicleId || '',
      vehicle: [vehicle?.brand, vehicle?.model, vehicle?.plate && `· ${vehicle.plate}`].filter(Boolean).join(' ') || assignment.vehicle || 'Vehículo no disponible',
      technicianId: assignment.technicianId || '',
      technician: technician?.name || assignment.technician || 'Técnico no disponible'
    }
  })
}

export function guardConfigurationSnapshot(rotation) {
  return (rotation || []).map((guard, index) => ({
    position: index + 1,
    technicianId: guard.technicianId || '',
    technician: guard.name || guard.technician || 'Técnico no disponible'
  }))
}

export function appendConfigurationHistory(history, { type, period, before, after, user, at = new Date().toISOString(), id } = {}) {
  const current = Array.isArray(history) ? history : []
  if (sameSnapshot(before, after)) return current
  const entry = {
    id: id || `configuration-${type}-${period}-${at}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    type,
    period,
    at,
    user: {
      id: user?.id || '',
      name: user?.name || user?.email || 'Administrador',
      email: user?.email || ''
    },
    before: clone(before || []),
    after: clone(after || [])
  }
  return [...current, entry]
}
