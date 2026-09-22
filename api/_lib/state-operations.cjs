const { mergeConcurrentState } = require('./state-merge.cjs')
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const sections = new Set(['roles', 'employees', 'services', 'vehicles', 'customers', 'history', 'reviews', 'agenda', 'preferences'])
const pendingControl = task => task?.vehicleControl && (!task.status || task.status === 'Pendiente') && !task.technicalStatus && !task.completedAt && !task.startedAt
function conflict(path) {
  const error = new Error('Este registro cambió o fue eliminado desde otra sesión. Tus cambios no se guardaron. Revisá la versión actual antes de reintentar.')
  Object.assign(error, { statusCode: 409, code: 'RECORD_WRITE_CONFLICT', conflictPath: JSON.stringify(path) })
  throw error
}

function applyStateOperations(current, operations) {
  if (!Array.isArray(operations) || operations.length > 20000) throw new Error('Operaciones de guardado inválidas.')
  // Check the authoritative pre-write state, even if the request also removes
  // its history. A concurrent service must never disappear with its team.
  for (const op of operations) {
    const path = op?.path || []
    if (path[0] !== 'agenda') continue
    const day = path[1] === 'weekly' ? path[2] : current.agenda?.date
    const ids = new Set()
    if (!op.exists && path.at(-1)?.key === 'teamId') ids.add(path.at(-1).id)
    if (path.at(-1) === 'removedTeams') {
      const previous = new Set((op.before || []).map(marker => marker.id))
      for (const marker of op.after || []) if (!previous.has(marker.id) && marker.teamId) ids.add(String(marker.teamId))
    }
    if (!ids.size) continue
    const teams = [...(current.agenda?.weekly?.[day]?.teams || []), ...(current.agenda?.date === day ? current.agenda.teams || [] : [])].filter(team => ids.has(String(team.teamId)))
    const tasks = teams.flatMap(team => team.tasks || [])
    const taskIds = new Set(tasks.map(task => String(task.taskId || '')).filter(Boolean))
    // Administrator-only omission is enforced by authorizeIncomingState after
    // applying operations. Completed or started controls remain protected here.
    if (tasks.some(task => !pendingControl(task) && (task.serviceId || task.service || task.customerId || task.client || task.vehicleControl || task.historyId || task.reservation)) || (current.history || []).some(record => !pendingControl(record) && (taskIds.has(String(record.sourceTaskId || '')) || (record.date === day && ids.has(String(record.teamId)))))) {
      throw Object.assign(new Error('No se puede eliminar un equipo con servicios cargados, pendientes o completados. Sólo se pueden eliminar equipos sin servicios.'), { statusCode: 409, code: 'TEAM_HAS_SERVICES' })
    }
  }
  const next = structuredClone(current)
  for (const operation of operations) {
    const { path, before, after, existed, exists } = operation || {}
    if (!Array.isArray(path) || !path.length || path.length > 20 || !sections.has(path[0]) || typeof existed !== 'boolean' || typeof exists !== 'boolean') throw new Error('Operación de guardado inválida.')
    if (path[0] === 'history' && (path.length !== 2 || path[1]?.key !== 'id')) throw new Error('El historial sólo admite operaciones por identificador de servicio.')
    let parent = next
    let key
    for (let index = 0; index < path.length; index++) {
      const segment = path[index]
      if (typeof segment === 'string') {
        if (forbidden.has(segment) || !parent || Array.isArray(parent) || typeof parent !== 'object') throw new Error('Ruta de guardado inválida.')
        key = segment
      } else {
        const expectedKey = path[index - 1] === 'customers' ? 'customerId' : path[index - 1] === 'tasks' ? 'taskId' : path[index - 1] === 'teams' ? 'teamId' : 'id'
        if (!segment || segment.key !== expectedKey || typeof segment.id !== 'string' || !Array.isArray(parent)) throw new Error('Identificador de guardado inválido.')
        const matches = parent.flatMap((item, i) => item && String(item[segment.key]) === segment.id ? [i] : [])
        if (matches.length > 1) conflict(path)
        key = matches[0] ?? parent.length
      }
      if (index < path.length - 1) {
        if (!Object.hasOwn(parent, key)) conflict(path)
        parent = parent[key]
      }
    }
    const found = Object.hasOwn(parent, key)
    if (found === exists && (!exists || equal(parent[key], after))) continue // safe retry after a lost response
    if (found !== existed || (found && !equal(parent[key], before))) {
      // Two sessions may materialize the same previously virtual day. Merge only
      // structural additions; existing service edits never enter this branch.
      const structural = path[0] === 'agenda' && (path.length === 3 && path[1] === 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(path[2]) || path.at(-1)?.key === 'teamId')
      if (!existed && exists && found && structural) {
        parent[key] = mergeConcurrentState({ agenda: {} }, { agenda: { node: parent[key] } }, { agenda: { node: after } }).agenda.node
        continue
      }
      conflict(path)
    }
    if (exists) {
      const selector = path.at(-1)
      if (typeof selector === 'object' && String(after?.[selector.key]) !== selector.id) throw new Error('No se puede cambiar la identidad del registro.')
      parent[key] = structuredClone(after)
    } else if (Array.isArray(parent)) parent.splice(key, 1)
    else delete parent[key]
  }
  for (const [day, plan] of Object.entries(next.agenda?.weekly || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const removed = new Set((plan.removedTeams || []).map(marker => String(marker.teamId || '')).filter(Boolean))
    const previousIds = new Set((current.agenda?.weekly?.[day]?.teams || []).map(team => String(team.teamId)))
    if ((plan.teams || []).some(team => !previousIds.has(String(team.teamId)) && removed.has(String(team.teamId)))) conflict(['agenda', 'weekly', day, 'teams'])
  }
  return next
}
module.exports = { applyStateOperations }
