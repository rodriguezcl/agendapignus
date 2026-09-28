import { weeklyServiceOperations } from './weekly-service-save.mjs'

// The daily editor publishes its draft to React before confirmation. It is not
// a persisted CAS baseline. Use the last acknowledged snapshot, after the
// caller has waited for its own in-flight autosave; never fetch/rebase remotely.
export function dailyServiceOperations(server, revision, command) {
  if (!server || Number(server.revision) !== Number(revision)) throw new Error('Esperá a que termine de actualizarse la agenda antes de guardar.')
  const baseTask = server.agenda?.weekly?.[command.day]?.teams
    ?.find(team => String(team.teamId) === String(command.team.teamId))?.tasks
    ?.find(task => String(task.taskId) === String(command.task.taskId))
  return weeklyServiceOperations(server, { ...command, baseTask: baseTask || null })
}
