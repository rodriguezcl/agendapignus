const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'

function businessError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function argentinaDateTime(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(now)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

function recordIsResolved(record = {}) {
  return Boolean(record.technicalStatus || ['Completado', 'Cancelado', 'Reprogramado'].includes(record.status))
}

function assignedTo(record, user) {
  return (record.technicianIds || []).some(id => String(id) === String(user?.id))
}

function requestServiceAdvance(record, user, now = Date.now()) {
  if (!record) throw businessError('El servicio no existe.', 404)
  if (!assignedTo(record, user)) throw businessError('El servicio no está asignado al técnico autenticado.', 403)
  if (record.advanceRequest?.status === 'pending') return record
  if (record.vehicleControl) throw businessError('Los controles vehiculares tienen su propia regla de habilitación.')
  if (recordIsResolved(record)) throw businessError('El servicio ya fue informado y no puede adelantarse.', 409)
  const current = argentinaDateTime(now)
  const scheduledTime = String(record.time || record.scheduledTime || '').slice(0, 5)
  if (String(record.date || '') !== current.date) throw businessError('Sólo se pueden adelantar servicios programados para hoy.', 409)
  if (!/^\d{2}:\d{2}$/.test(scheduledTime) || scheduledTime <= current.time) throw businessError('El servicio ya se encuentra habilitado por su horario.', 409)
  const requestedAt = new Date(now).toISOString()
  return {
    ...record,
    advanceRequest: {
      status: 'pending', requestedAt,
      requestedById: user.id,
      requestedByName: user.name || user.email || 'Técnico',
      scheduledTime
    }
  }
}

function resolveServiceAdvance(record, administrator, decision, now = Date.now()) {
  if (!record) throw businessError('El servicio no existe.', 404)
  if (!['approved', 'denied'].includes(decision)) throw businessError('La decisión indicada no es válida.')
  if (record.advanceRequest?.status !== 'pending') throw businessError('La solicitud ya fue resuelta o dejó de estar disponible.', 409)
  if (recordIsResolved(record)) throw businessError('El servicio ya fue informado y la solicitud no puede modificarse.', 409)
  const resolvedAt = new Date(now).toISOString()
  const request = {
    ...record.advanceRequest,
    status: decision,
    resolvedAt,
    resolvedById: administrator.id,
    resolvedByName: administrator.name || administrator.email || 'Administrador'
  }
  if (decision === 'denied') return { ...record, advanceRequest: request }
  const current = argentinaDateTime(now)
  const scheduledTime = String(record.advanceRequest.scheduledTime || record.originalScheduledTime || record.time || '').slice(0, 5)
  if (String(record.date || '') !== current.date || !/^\d{2}:\d{2}$/.test(scheduledTime) || scheduledTime <= current.time) {
    throw businessError('El horario original ya llegó o el día finalizó; el servicio no necesita un adelanto.', 409)
  }
  const approvedTime = current.time
  const originalScheduledTime = record.originalScheduledTime || record.advanceRequest.scheduledTime || record.scheduledTime || record.time
  return { ...record, originalScheduledTime, time: approvedTime, scheduledTime: approvedTime, advanceRequest: { ...request, approvedTime } }
}

function synchronizeAgendaAdvance(agenda, record) {
  if (!agenda || typeof agenda !== 'object') return agenda
  const matches = task => String(task?.historyId || '') === String(record.id) || (record.sourceTaskId && String(task?.taskId || '') === String(record.sourceTaskId))
  const synchronizeTeams = teams => (teams || []).map(team => ({
    ...team,
    tasks: (team.tasks || []).map(task => matches(task) ? {
      ...task,
      time: record.time,
      scheduledTime: record.scheduledTime,
      ...(record.originalScheduledTime ? { originalScheduledTime: record.originalScheduledTime } : {}),
      advanceRequest: record.advanceRequest
    } : task)
  }))
  const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, plan]) => [
    key,
    key.startsWith('_') || !plan || typeof plan !== 'object' ? plan : { ...plan, teams: synchronizeTeams(plan.teams) }
  ]))
  return { ...agenda, teams: synchronizeTeams(agenda.teams), weekly }
}

module.exports = { argentinaDateTime, requestServiceAdvance, resolveServiceAdvance, synchronizeAgendaAdvance }
