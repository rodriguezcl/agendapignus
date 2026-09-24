const sameId = (left, right) => String(left || '') === String(right || '')
const closedRecord = record => ['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado'].includes(record?.status) || Boolean(record?.technicalStatus)
const operation = (path, before, after) => ({
  path,
  before: before ?? null,
  after: after ?? null,
  existed: before !== undefined,
  exists: after !== undefined
})
const teamPath = (prefix, teamId) => [...prefix, { key: 'teamId', id: String(teamId) }]
const taskPath = (prefix, taskId) => [...prefix, { key: 'taskId', id: String(taskId) }]
const aliases = task => [
  task?.taskId && `task:${task.taskId}`,
  task?.historyId && `history:${task.historyId}`
].filter(Boolean)

function resolveTeamIndex(teams, teamId, teamIndex) {
  const byId = (teams || []).findIndex(team => teamId && sameId(team.teamId, teamId))
  return byId >= 0 ? byId : Number(teamIndex)
}

function resolveTaskIndex(tasks, { taskId, historyId, taskIndex, time }) {
  const byIdentity = (tasks || []).findIndex(task =>
    (taskId && sameId(task.taskId, taskId)) ||
    (historyId && sameId(task.historyId, historyId))
  )
  if (byIdentity >= 0) return byIdentity
  const candidate = (tasks || [])[Number(taskIndex)]
  if (!candidate) return -1
  const candidateTime = String(candidate.time || candidate.scheduledTime || '').trim()
  return !time || candidateTime === String(time).trim() ? Number(taskIndex) : -1
}

function resolveLegacyVehicleControlIndex(tasks, record) {
  if (!record?.vehicleControl) return -1
  const recordVehicleId = String(record.vehicleId || '').trim()
  const recordTime = String(record.time || record.scheduledTime || '').trim()
  const recordClient = String(record.client || '').trim()
  return (tasks || []).findIndex(task => {
    if (!task?.vehicleControl) return false
    const sameVehicle = recordVehicleId && String(task.vehicleId || '').trim() === recordVehicleId
    const sameClient = recordClient && String(task.client || '').trim() === recordClient
    const sameTime = !recordTime || String(task.time || task.scheduledTime || '').trim() === recordTime
    return sameTime && (sameVehicle || sameClient)
  })
}

function removalFromTeam(operations, prefix, team, taskIndex) {
  const task = team?.tasks?.[taskIndex]
  if (!task) return
  if (task.taskId) {
    operations.push(operation(taskPath([...teamPath(prefix, team.teamId), 'tasks'], task.taskId), task, undefined))
    return
  }
  operations.push(operation(
    teamPath(prefix, team.teamId),
    team,
    { ...team, tasks: (team.tasks || []).filter((_, index) => index !== taskIndex) }
  ))
}

// Removing a weekly service or omitting a vehicle control is one confirmed
// command. All projections and the pending history record change together,
// avoiding a second debounced save built from an obsolete revision.
export function weeklyTaskRemovalOperations(snapshot, command) {
  const { day, teamId, teamIndex, taskId, historyId, taskIndex, time, wasPlaceholder, fallbackPlan } = command
  let plan = snapshot?.agenda?.weekly?.[day]
  if (!plan) {
    if (!fallbackPlan) throw new Error('El día todavía no está disponible. Recargá la planificación e intentá nuevamente.')
    plan = fallbackPlan
  }

  const resolvedTeamIndex = resolveTeamIndex(plan.teams || [], teamId, teamIndex)
  const team = plan.teams?.[resolvedTeamIndex]
  if (!team) return []
  const resolvedTaskIndex = resolveTaskIndex(team.tasks || [], { taskId, historyId, taskIndex, time })
  const task = team.tasks?.[resolvedTaskIndex]
  // An exact retry after a response was lost is already complete.
  if (!task) return []

  const operations = []
  if (snapshot?.agenda?.weekly?.[day]) {
    removalFromTeam(operations, ['agenda', 'weekly', day, 'teams'], team, resolvedTaskIndex)
    const removedTaskIds = [...new Set([...(plan.removedTaskIds || []), ...aliases(task)])]
    operations.push(operation(['agenda', 'weekly', day, 'removedTaskIds'], plan.removedTaskIds, removedTaskIds))
    if (wasPlaceholder) {
      const marker = {
        teamId: team.teamId || '',
        teamNumber: Number(String(team.label || '').match(/\d+/)?.[0]) || resolvedTeamIndex + 1,
        time: String(time || task.time || task.scheduledTime || '').trim()
      }
      const removedSlots = [...(plan.removedSlots || [])]
      if (marker.time && !removedSlots.some(slot => sameId(slot.teamId, marker.teamId) && String(slot.time || '').trim() === marker.time)) removedSlots.push(marker)
      operations.push(operation(['agenda', 'weekly', day, 'removedSlots'], plan.removedSlots, removedSlots))
    }
  } else {
    const removedTaskIds = [...new Set([...(plan.removedTaskIds || []), ...aliases(task)])]
    const teams = (plan.teams || []).map((item, index) => index === resolvedTeamIndex
      ? { ...item, tasks: (item.tasks || []).filter((_, currentIndex) => currentIndex !== resolvedTaskIndex) }
      : item)
    operations.push(operation(['agenda', 'weekly', day], undefined, { ...plan, removedTaskIds, teams }))
  }

  for (const record of snapshot.history || []) {
    const historyIdentity = task.historyId || historyId
    const matches = Boolean(historyIdentity && sameId(record.id, historyIdentity)) || Boolean(task.taskId && sameId(record.sourceTaskId, task.taskId))
    if (!matches || closedRecord(record)) continue
    if (record.serviceJourney && record.startedAt) throw new Error('La jornada ya fue iniciada. Registrá su resultado o cancelala desde el historial antes de quitarla de la agenda.')
    // Linked visits retain their identity and reports even when the remaining
    // reservation is no longer needed. Deleting one breaks the journey group.
    const after = record.serviceJourney ? { ...record, status: 'Cancelado', scheduledDate: '', awaitingConfirmation: false } : undefined
    operations.push(operation(['history', { key: 'id', id: String(record.id) }], record, after))
  }

  if (snapshot?.agenda?.date === day) {
    const dailyTeams = snapshot.agenda.teams || []
    const dailyTeamIndex = resolveTeamIndex(dailyTeams, team.teamId, resolvedTeamIndex)
    const dailyTeam = dailyTeams[dailyTeamIndex]
    const dailyTaskIndex = resolveTaskIndex(dailyTeam?.tasks || [], {
      taskId: task.taskId,
      historyId: task.historyId,
      taskIndex: resolvedTaskIndex,
      time: task.time || task.scheduledTime
    })
    if (dailyTeam && dailyTaskIndex >= 0) removalFromTeam(operations, ['agenda', 'teams'], dailyTeam, dailyTaskIndex)
  }
  return operations
}

// History can be the only editable projection once a day has finished. Locate
// its weekly task and reuse the same atomic removal, then make sure the record
// itself is deleted even for historical data whose agenda card no longer exists.
export function historyRecordRemovalOperations(snapshot, record) {
  const recordId = String(record?.id || '').trim()
  if (!recordId) throw new Error('El servicio solicitado no es válido.')
  const currentRecord = (snapshot.history || []).find(item => sameId(item.id, recordId))
  // An exact retry after a response was lost is already complete.
  if (!currentRecord) return []

  const day = String(currentRecord.date || record.date || '').trim()
  const plan = snapshot?.agenda?.weekly?.[day]
  let linked = null
  for (const [teamIndex, team] of (plan?.teams || []).entries()) {
    let taskIndex = resolveTaskIndex(team.tasks || [], {
      taskId: currentRecord.sourceTaskId,
      historyId: currentRecord.id,
      taskIndex: -1
    })
    if (taskIndex < 0) taskIndex = resolveLegacyVehicleControlIndex(team.tasks || [], currentRecord)
    if (taskIndex >= 0) { linked = { team, teamIndex, taskIndex, task: team.tasks[taskIndex] }; break }
  }

  const operations = linked ? weeklyTaskRemovalOperations(snapshot, {
    day,
    teamId: linked.team.teamId,
    teamIndex: linked.teamIndex,
    taskId: linked.task.taskId || currentRecord.sourceTaskId,
    historyId: linked.task.historyId || currentRecord.id,
    taskIndex: linked.taskIndex,
    time: linked.task.time || linked.task.scheduledTime
  }) : []

  if (plan && currentRecord.vehicleControl && !linked) {
    const removedTaskIds = [...new Set([...(plan.removedTaskIds || []), ...aliases({ taskId: currentRecord.sourceTaskId, historyId: currentRecord.id })])]
    if (JSON.stringify(removedTaskIds) !== JSON.stringify(plan.removedTaskIds || [])) {
      operations.push(operation(['agenda', 'weekly', day, 'removedTaskIds'], plan.removedTaskIds, removedTaskIds))
    }
  }
  if (!operations.some(item => item.path[0] === 'history' && item.path[1]?.id === recordId)) {
    operations.push(operation(['history', { key: 'id', id: recordId }], currentRecord, undefined))
  }
  return operations
}
