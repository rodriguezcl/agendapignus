const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
function validateMonthlyHours(month, config = {}) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('Elegí un mes válido.')
  const timesValid = times => Array.isArray(times) && times.length === 2 && times.every(time => timePattern.test(String(time))) && times[0] < times[1]
  if (config.defaultTimes !== undefined && !timesValid(config.defaultTimes)) throw new Error('Ingresá dos horarios válidos, en orden de menor a mayor.')
  if (config.defaultTimePeriods !== undefined) {
    if (!Array.isArray(config.defaultTimePeriods) || config.defaultTimePeriods.length > 31) throw new Error('La configuración de horarios del mes no es válida.')
    const seen = new Set()
    for (const period of config.defaultTimePeriods) {
      const date = String(period?.from || '')
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
      if (!validDate || !date.startsWith(`${month}-`) || seen.has(date) || !timesValid(period?.times)) throw new Error('Revisá las fechas y los horarios: cada fecha debe pertenecer al mes y aparecer una sola vez.')
      seen.add(date)
    }
  }
  return true
}
function validateMonthlyHoursChange(month, before = {}, after = {}, today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())) {
  validateMonthlyHours(month, after)
  if (month < today.slice(0, 7)) throw new Error('Los horarios de meses finalizados no se pueden modificar.')
  const periods = config => config.defaultTimePeriods?.length ? config.defaultTimePeriods
    : config.defaultTimes ? [{ from: `${month}-01`, times: config.defaultTimes }] : []
  const past = config => periods(config).filter(period => period.from < today).sort((a, b) => a.from.localeCompare(b.from))
  if (JSON.stringify(past(before)) !== JSON.stringify(past(after))) throw new Error('Los períodos de horarios anteriores a hoy deben conservarse.')
  return true
}
module.exports = { validateMonthlyHours, validateMonthlyHoursChange }
