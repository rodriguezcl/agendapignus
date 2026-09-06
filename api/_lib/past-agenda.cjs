const SCHEDULE_TIME_ZONE = 'America/Argentina/Buenos_Aires'

function argentinaToday(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(instant.getTime())) return ''
  return instant.toLocaleDateString('sv-SE', { timeZone: SCHEDULE_TIME_ZONE })
}

const taskHasServiceContent = task => Boolean(task && (
  task.historyId || task.customerId || task.serviceId ||
  ['client', 'service', 'address', 'phone', 'detail', 'internalNote'].some(key => String(task[key] || '').trim())
))

const planTasks = plan => (plan?.teams || []).flatMap((team, teamIndex) => (team.tasks || []).map((task, taskIndex) => ({ task, teamIndex, taskIndex })))

function assertNoPastWeeklyServiceAdditions(nextAgenda = {}, previousAgenda = {}, now = new Date()) {
  const today = argentinaToday(now)
  if (!today) return
  const nextWeekly = nextAgenda?.weekly || {}
  const previousWeekly = previousAgenda?.weekly || {}
  for (const [day, nextPlan] of Object.entries(nextWeekly)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today) continue
    const nextTasks = planTasks(nextPlan)
    const previousTasks = planTasks(previousWeekly[day])
    if (nextTasks.length > previousTasks.length) throw new Error(`La jornada del ${day} ya finalizó y no admite servicios nuevos.`)
    const previousById = new Map(previousTasks.flatMap(({ task }) => [task?.taskId, task?.historyId].filter(Boolean).map(id => [String(id), task])))
    nextTasks.forEach(({ task, teamIndex, taskIndex }) => {
      const previous = [task?.taskId, task?.historyId].filter(Boolean).map(id => previousById.get(String(id))).find(Boolean) || previousTasks.find(item => item.teamIndex === teamIndex && item.taskIndex === taskIndex)?.task
      if ((!previous || !taskHasServiceContent(previous)) && taskHasServiceContent(task)) throw new Error(`La jornada del ${day} ya finalizó y no admite servicios nuevos.`)
    })
  }
}

module.exports = { argentinaToday, assertNoPastWeeklyServiceAdditions }
