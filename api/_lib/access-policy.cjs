const { isOperator } = require('./operator-access.cjs')
const normalizedRoleName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

const FEATURE_PERMISSION_PARENTS = {
  collectionsManage: 'collections',
  weeklyTeams: 'weekly',
  weeklyHours: 'weekly',
  weeklyVehicles: 'weekly',
  weeklyGuards: 'weekly',
  historyManage: 'history',
  accountsEdit: 'accounts',
  accountsDelete: 'accounts',
  accountsImport: 'accounts'
}

function userCan(user, permission) {
  if (isOperator(user)) return permission === 'weekly'
  if (user?.roleCode === 'administrator') return true
  if (user?.roleCode === 'supervisor' || normalizedRoleName(user?.role) === 'supervisor') return permission === 'history' || permission === 'accounts'
  const parent = FEATURE_PERMISSION_PARENTS[permission]
  if (parent && user?.permissions?.[parent] !== true) return false
  if (typeof user?.permissions?.[permission] === 'boolean') return user.permissions[permission]
  // Los permisos granulares son opt-in para cualquier rol no administrativo.
  // Un rol creado antes de esta versión no debe heredar por accidente acciones
  // de escritura o configuración sólo por poder visualizar el módulo padre.
  return false
}

function assertVehicleControlOmissionAuthorized(incoming, current, user) {
  if (user?.roleCode === 'administrator') return
  const deny = () => {
    const error = new Error('Solamente un administrador puede omitir o eliminar un control vehicular.')
    error.statusCode = 403
    throw error
  }
  const currentWeekly = current?.agenda?.weekly || {}
  const incomingWeekly = incoming?.agenda?.weekly || {}
  for (const [day, currentPlan] of Object.entries(currentWeekly)) {
    if (day.startsWith('_')) continue
    const controlTeams = (currentPlan?.teams || []).filter(team => (team.tasks || []).some(task => task?.vehicleControl))
    const controls = controlTeams.flatMap(team => team.tasks || []).filter(task => task?.vehicleControl)
    if (!controls.length) continue
    const previousRemoved = new Set((currentPlan?.removedTaskIds || []).map(String))
    const newlyRemoved = (incomingWeekly?.[day]?.removedTaskIds || []).map(String).filter(id => !previousRemoved.has(id))
    if (controls.some(task => {
      const aliases = [task.taskId && `task:${task.taskId}`, task.historyId && `history:${task.historyId}`].filter(Boolean)
      return aliases.some(alias => newlyRemoved.includes(alias))
    })) deny()
    const previousRemovedTeams = new Set((currentPlan?.removedTeams || []).map(marker => String(marker.id || '')))
    const newlyRemovedTeams = (incomingWeekly?.[day]?.removedTeams || []).filter(marker => !previousRemovedTeams.has(String(marker.id || '')))
    if (controlTeams.some(team => newlyRemovedTeams.some(marker =>
      String(marker.teamId || '') === String(team.teamId || '') || String(marker.id || '') === `team:${team.teamId}`
    ))) deny()
  }
  if (userCan(user, 'historyManage')) {
    const incomingHistoryIds = new Set((incoming?.history || []).map(record => String(record.id)))
    if ((current?.history || []).some(record => record?.vehicleControl && !incomingHistoryIds.has(String(record.id)))) deny()
  }
}

module.exports = { userCan, assertVehicleControlOmissionAuthorized }
