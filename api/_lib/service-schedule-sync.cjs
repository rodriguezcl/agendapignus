const schedule = item => ({ time: item.time || item.scheduledTime || '', estimatedMinutes: item.estimatedMinutes, estimatedMinutesCustomized: item.estimatedMinutesCustomized })
const same = (a, b) => JSON.stringify(schedule(a || {})) === JSON.stringify(schedule(b || {}))
const linked = (task, record) => Boolean(task.historyId && String(task.historyId) === String(record.id) || task.taskId && record.sourceTaskId && String(task.taskId) === String(record.sourceTaskId))
const tasksFor = (state, day) => [state.agenda?.weekly?.[day], ...(state.agenda?.date === day ? [state.agenda] : [])].flatMap(plan => (plan?.teams || []).flatMap(team => team.tasks || []))

// Synchronize only explicitly changed schedules. Unrelated saves must not choose
// between conflicting legacy copies. Conflicting edits fail atomically.
function synchronizeServiceSchedules(state, previous = {}) {
  const next = structuredClone(state)
  for (const record of next.history || []) {
    const old = (previous.history || []).find(item => String(item.id) === String(record.id))
    const copies = tasksFor(next, record.date).filter(task => linked(task, record))
    if (!copies.length) continue
    const oldCopies = tasksFor(previous, old?.date || record.date)
    const changed = []
    if (!old || !same(record, old)) changed.push(record)
    for (const task of copies) {
      const baseline = oldCopies.find(item => item.taskId && String(item.taskId) === String(task.taskId) && same(item, task))
        || oldCopies.find(item => item.taskId && String(item.taskId) === String(task.taskId))
      if (!baseline || !same(task, baseline)) changed.push(task)
    }
    if (!changed.length) continue
    const source = changed[0]
    if (changed.some(item => !same(item, source))) throw Object.assign(new Error('El horario o la duración del servicio no coincide entre agenda e historial. Volvé a abrir el servicio antes de guardar.'), { statusCode: 409, code: 'SERVICE_SCHEDULE_CONFLICT' })
    for (const item of [record, ...copies]) Object.assign(item, schedule(source), { scheduledTime: schedule(source).time })
  }
  return next
}
module.exports = { synchronizeServiceSchedules }
