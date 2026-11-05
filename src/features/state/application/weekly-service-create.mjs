import { weeklyServiceOperations } from './weekly-service-save.mjs'

// A new service has no persisted record baseline. Build its containers from
// the acknowledged server snapshot, not from teams reconstructed for display.
export function weeklyServiceCreationOperations(server, revision, command) {
  if (!server || Number(server.revision) !== Number(revision)) throw new Error('Esperá a que termine de actualizarse la agenda antes de guardar.')
  if (command.baseRecord || command.baseTask || command.sourceDay) throw new Error('El alta sólo admite servicios nuevos.')
  const operations = weeklyServiceOperations(server, command)
  const team = server.agenda?.weekly?.[command.day]?.teams?.find(item => String(item.teamId) === String(command.team.teamId))
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
