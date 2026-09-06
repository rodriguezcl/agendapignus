const normalizeIdentity = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('es')

const timeInMinutes = value => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null
}

export const hasScheduledService = task => Boolean(task && (
  task.historyId || task.customerId || task.serviceId ||
  ['client', 'service', 'address', 'phone', 'detail'].some(key => String(task[key] || '').trim())
))

const teamIncludesTechnician = (team, technicianId, technicianName) => {
  if (technicianId && (team?.memberIds || []).some(id => String(id) === String(technicianId))) return true
  const expectedName = normalizeIdentity(technicianName)
  return Boolean(expectedName) && (team?.members || []).some(name => normalizeIdentity(name) === expectedName)
}

/**
 * Detecta si el técnico de guardia sabatina ya cubrió esa guardia el viernes.
 * El rango es inclusivo: 16:00 a 20:00.
 */
export const findAdvancedSaturdayGuard = ({ fridayPlan, saturdayPlan }) => {
  const saturdayTeams = saturdayPlan?.teams || []
  const saturdayTeam = saturdayTeams[0]
  const assignedSaturdayId = saturdayTeam?.memberIds?.[0] || ''
  const assignedSaturdayName = saturdayTeam?.members?.[0] || ''
  const candidates = []

  for (const fridayTeam of fridayPlan?.teams || []) {
    const advancedTask = (fridayTeam.tasks || []).find(task => {
      const minutes = timeInMinutes(task?.time || task?.scheduledTime)
      return hasScheduledService(task) && minutes !== null && minutes >= 16 * 60 && minutes <= 20 * 60
    })
    if (!advancedTask) continue

    const technicianId = fridayTeam.memberIds?.[0] || ''
    const technicianName = fridayTeam.members?.[0] || ''
    if (!technicianId && !technicianName) continue
    candidates.push({
      technicianId,
      technicianName,
      displayName: String(technicianName || 'El técnico').trim().split(/\s+/)[0],
      fridayTime: advancedTask.time || advancedTask.scheduledTime,
      fridayTask: advancedTask
    })
  }
  if (!candidates.length) return null

  // Si el sábado ya tenía al guardia correcto, se prioriza esa coincidencia.
  // Si alguien asigna otro técnico, la guardia del viernes sigue vigente y no
  // puede desaparecer por esa modificación posterior.
  const advance = candidates.find(candidate => teamIncludesTechnician(
    { memberIds: [candidate.technicianId], members: [candidate.technicianName] },
    assignedSaturdayId,
    assignedSaturdayName
  )) || candidates[0]
  const saturdayServices = saturdayTeams.flatMap(team => team?.tasks || []).filter(hasScheduledService)
  return {
    ...advance,
    saturdayServices,
    hasSaturdayConflict: saturdayServices.length > 0
  }
}

/** Oculta únicamente espacios disponibles; nunca elimina servicios reales. */
export const suppressAdvancedSaturdayAvailability = (saturdayPlan, advance) => {
  if (!advance) return saturdayPlan
  return {
    ...saturdayPlan,
    teams: (saturdayPlan?.teams || [])
      .map(team => ({ ...team, tasks: (team.tasks || []).filter(hasScheduledService) }))
      .filter(team => team.tasks.length > 0)
  }
}

export const advancedSaturdayGuardMessage = advance => {
  if (!advance) return ''
  if (advance.hasSaturdayConflict) {
    return `Conflicto de guardia: ${advance.displayName} adelantó su guardia al viernes a las ${advance.fridayTime}, pero también tiene un servicio cargado el sábado.`
  }
  return `Guardia adelantada: ${advance.displayName} cubrió el servicio de fin de semana el viernes a las ${advance.fridayTime}. El sábado no admite nuevas asignaciones.`
}
