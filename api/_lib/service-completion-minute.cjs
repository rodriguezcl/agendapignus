// The agenda accepts HH:mm. Keep precise timestamps for reports, but compare
// occupied slots at that same minute precision on both client and server.
function serviceCompletionMinute(task) {
  if (!['Completado', 'Avance registrado'].includes(task?.status) && !['Completado', 'Avance registrado'].includes(task?.technicalStatus)) return null
  const completedAt = task.completedAt || task.journeyClosedAt || task.technicalReportedAt
  const instant = new Date(completedAt)
  const match = String(task.time || task.scheduledTime || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!completedAt || Number.isNaN(instant.getTime()) || !match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  if (`${parts.year}-${parts.month}-${parts.day}` !== String(task.date || '')) return null
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  if (minutes < Number(match[1]) * 60 + Number(match[2])) return null
  return { completedAt, minutes }
}

module.exports = { serviceCompletionMinute }
