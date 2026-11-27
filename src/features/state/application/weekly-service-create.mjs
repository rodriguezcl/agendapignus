import { weeklyServiceOperations } from './weekly-service-save.mjs'

// A new service has no persisted record baseline. Build its containers from
// the acknowledged server snapshot, not from teams reconstructed for display.
export function weeklyServiceCreationOperations(server, revision, command) {
  if (!server || Number(server.revision) !== Number(revision)) throw new Error('Esperá a que termine de actualizarse la agenda antes de guardar.')
  if (command.baseRecord || command.sourceDay) throw new Error('El alta sólo admite servicios nuevos.')
  const team = server.agenda?.weekly?.[command.day]?.teams?.find(item => String(item.teamId) === String(command.team.teamId))
  if (command.baseTask && (command.baseTask.taskId !== command.task.taskId || !team?.tasks?.some(item => item.taskId === command.baseTask.taskId))) {
    throw new Error('La tarjeta original ya no está en el equipo. Revisá la agenda antes de guardar.')
  }
  // The server mirrors the authorized card into the daily agenda for the date
  // actually open when the command commits. That agenda can be hidden or stale.
  const operations = weeklyServiceOperations(server, command, { mirrorDaily: false })
  const creation = operations.find(op => op.path[0] === 'history')
  creation.mirrorWeeklyTaskId = command.task.taskId
  const weekly = server.agenda?.weekly
  const saturday = new Date(command.day + 'T12:00:00Z').getUTCDay() === 6
  const monthly = !saturday && (!team || !Object.hasOwn(team, 'memberIds') || !Object.hasOwn(team, 'members')) &&
    weekly?._monthlyTeams?.[command.day.slice(0, 7)]?.teams?.some(item => String(item.teamId) === String(command.team.teamId))
  if (monthly || saturday && !team?.memberIds?.length && !team?.members?.length) {
    const ids = command.team.memberIds || []
    creation.inheritedCrew = { source: saturday ? 'guard' : 'monthly', ...(ids.length ? { memberIds: ids } : { members: command.team.members || [] }) }
  }
  if (team) {
    // Do not silently assign a new service to a team changed after this snapshot.
    for (const key of ['memberIds', 'members']) {
      operations.unshift({
        path: ['agenda', 'weekly', command.day, 'teams', { key: 'teamId', id: String(team.teamId) }, key],
        before: team[key] ?? null, after: team[key] ?? null,
        existed: Object.hasOwn(team, key), exists: Object.hasOwn(team, key)
      })
    }
  }
  return operations
}
