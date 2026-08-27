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
  const saturdayTeam = saturdayPlan?.teams?.[0]
  const assignedSaturdayId = saturdayTeam?.memberIds?.[0] || ''
  const assignedSaturdayName = saturdayTeam?.members?.[0] || ''

  for (const fridayTeam of fridayPlan?.teams || []) {
    if ((assignedSaturdayId || assignedSaturdayName) && !teamIncludesTechnician(fridayTeam, assignedSaturdayId, assignedSaturdayName)) continue
    const advancedTask = (fridayTeam.tasks || []).find(task => {
      const minutes = timeInMinutes(task?.time || task?.scheduledTime)
      return hasScheduledService(task) && minutes !== null && minutes >= 16 * 60 && minutes <= 20 * 60
    })
    if (!advancedTask) continue

    const technicianId = assignedSaturdayId || fridayTeam.memberIds?.[0] || ''
    const technicianName = assignedSaturdayName || fridayTeam.members?.[0] || ''
    if (!technicianId && !technicianName) continue

    const saturdayServices = (saturdayTeam.tasks || []).filter(hasScheduledService)
    return {
      technicianId,
      technicianName,
      displayName: String(technicianName || 'El técnico').trim().split(/\s+/)[0],
      fridayTime: advancedTask.time || advancedTask.scheduledTime,
      fridayTask: advancedTask,
      saturdayServices,
      hasSaturdayConflict: saturdayServices.length > 0
    }
  }
  return null
}

/** Oculta únicamente espacios disponibles; nunca elimina servicios reales. */
export const suppressAdvancedSaturdayAvailability = (saturdayPlan, advance) => {
  if (!advance) return saturdayPlan
  return {
    ...saturdayPlan,
    teams: (saturdayPlan?.teams || []).map(team => ({
      ...team,
      tasks: (team.tasks || []).filter(hasScheduledService)
    }))
  }
}

export const advancedSaturdayGuardMessage = advance => {
  if (!advance) return ''
  if (advance.hasSaturdayConflict) {
    return `Conflicto de guardia: ${advance.displayName} adelantó su guardia al viernes a las ${advance.fridayTime}, pero también tiene un servicio cargado el sábado.`
  }
  return `Guardia adelantada: ${advance.displayName} cubrió el servicio de fin de semana el viernes a las ${advance.fridayTime}. El sábado no admite nuevas asignaciones.`
}
