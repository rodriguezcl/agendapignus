const sameId = (left, right) => String(left || '') === String(right || '')

const recordTaskMatch = (task, record) => {
  if (!task || !record) return false
  if (task.historyId && sameId(task.historyId, record.id)) return true
  if (record.sourceTaskId && task.taskId && sameId(task.taskId, record.sourceTaskId)) return true
  if (!record.vehicleControl || !task.vehicleControl) return false
  const sameVehicle = record.vehicleId && sameId(task.vehicleId, record.vehicleId)
  const sameClient = record.client && String(task.client || '').trim() === String(record.client).trim()
  const sameFriday = !record.vehicleControlScheduledFriday || !task.vehicleControlScheduledFriday || sameId(task.vehicleControlScheduledFriday, record.vehicleControlScheduledFriday)
  return sameFriday && (sameVehicle || sameClient)
}

const removalAliases = (record, matchedTasks = []) => [...new Set([
  record?.id && `history:${record.id}`,
  record?.sourceTaskId && `task:${record.sourceTaskId}`,
  ...matchedTasks.flatMap(task => [
    task?.historyId && `history:${task.historyId}`,
    task?.taskId && `task:${task.taskId}`
  ])
].filter(Boolean))]

function removeHistoryRecord(state, recordId) {
  const current = (state?.history || []).find(record => sameId(record.id, recordId))
  if (!current) return { state, record: null, changed: false }
  if (current.serviceJourney) throw new Error('No se puede eliminar una jornada vinculada. Cancelala para conservar el historial del servicio.')

  const next = structuredClone(state)
  const weekly = next.agenda?.weekly || {}
  const day = String(current.date || '')
  const plan = weekly[day]
  const matchedTasks = []

  if (plan?.teams) {
    plan.teams = plan.teams.map(team => ({
      ...team,
      tasks: (team.tasks || []).filter(task => {
        const matches = recordTaskMatch(task, current)
        if (matches) matchedTasks.push(task)
        return !matches
      })
    }))
    plan.removedTaskIds = [...new Set([...(plan.removedTaskIds || []), ...removalAliases(current, matchedTasks)])]
  }

  if (next.agenda && String(next.agenda.date || '') === day) {
    next.agenda.teams = (next.agenda.teams || []).map(team => ({
      ...team,
      tasks: (team.tasks || []).filter(task => !recordTaskMatch(task, current))
    }))
  }

  next.history = (next.history || []).filter(record => !sameId(record.id, recordId))
  return { state: next, record: current, changed: true }
}

module.exports = { recordTaskMatch, removeHistoryRecord }
