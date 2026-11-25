const { workdayForDate } = require('./workday.cjs')
const validDate = day => /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) && Number.isFinite(Date.parse(day + 'T12:00:00Z')) && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day
const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay()
const previousDate = day => { const date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10) }
const minutes = value => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3))

function vehicleControlFriday(record) {
  if (validDate(record?.vehicleControlScheduledFriday)) return record.vehicleControlScheduledFriday
  for (const key of ['id', 'historyId', 'sourceTaskId', 'taskId']) {
    const day = String(record?.[key] || '').match(/^vehicle-control-(\d{4}-\d{2}-\d{2})-/)?.[1]
    if (validDate(day)) return day
  }
  return record?.date || ''
}

function vehicleControlSchedule(friday, weekly = {}, teamId = '') {
  if (!validDate(friday) || weekday(friday) !== 5) throw new Error('El control vehicular debe corresponder a un viernes válido.')
  let date = friday
  for (let offset = 0; offset <= 2; offset++, date = previousDate(date)) {
    if (weekly._holidayOverrides?.[date]?.status === 'closed') continue
    const hours = workdayForDate(date, weekly, teamId)
    // Friday's extension to 20:00 is for advanced weekend guards only.
    const end = Math.min(minutes(hours.end), offset === 0 ? 16 * 60 : 24 * 60)
    const start = end - 15
    if (!Number.isFinite(start) || start < minutes(hours.bookable || hours.start) || (start < minutes(hours.breakEnd) && end > minutes(hours.breakStart))) throw new Error('La jornada no permite reservar los últimos 15 minutos para el control vehicular.')
    const time = String(Math.floor(start / 60)).padStart(2, '0') + ':' + String(start % 60).padStart(2, '0')
    return { date, time, estimatedMinutes: 15 }
  }
  throw new Error('No hay una jornada habilitada para el control: viernes, jueves y miércoles están definidos como no operativos.')
}
module.exports = { vehicleControlFriday, vehicleControlSchedule }
