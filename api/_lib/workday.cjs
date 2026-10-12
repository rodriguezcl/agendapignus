const defaults = day => ({ start: '08:00', bookable: '08:30', end: day === 5 ? '20:00' : day === 6 ? '12:00' : '17:00', breakStart: '13:30', breakEnd: '14:00' })
const time = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
function validateWorkday(config) {
  if (config == null) return
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('Jornada laboral inválida.')
  for (const collection of ['weekdays', 'exceptions']) {
    for (const [key, row] of Object.entries(config[collection] || {})) {
      if (collection === 'weekdays' ? !/^[1-6]$/.test(key) : !/^\d{4}-\d{2}-\d{2}(?:\|[^|]+)?$/.test(key)) throw new Error('Fecha o equipo de jornada inválido.')
      if (!row || !['start', 'bookable', 'end', 'breakStart', 'breakEnd'].every(field => time(row[field])) || row.start > row.bookable || row.bookable >= row.end || row.breakStart >= row.breakEnd) throw new Error('Revisá la jornada: ingreso ≤ inicio de servicios < salida y descanso con inicio anterior al fin.')
    }
  }
}
function workdayForDate(day, weekly = {}, teamId = '') {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  if (!weekday || !Number.isInteger(weekday)) return null
  const config = weekly._workday || {}
  return { ...defaults(weekday), ...config.weekdays?.[weekday], ...config.exceptions?.[day], ...(teamId ? config.exceptions?.[`${day}|${teamId}`] : {}) }
}
module.exports = { defaults, validateWorkday, workdayForDate }
