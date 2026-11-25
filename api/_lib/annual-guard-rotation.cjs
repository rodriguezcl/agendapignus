const { guardEligibleOnDate, isCalendarDate } = require('./guard-eligibility.cjs')
const WEEK = 604800000

const firstSaturday = year => {
 const date = new Date(year + '-01-01T12:00:00Z')
 date.setUTCDate(date.getUTCDate() + (6 - date.getUTCDay() + 7) % 7)
 return date.toISOString().slice(0, 10)
}
function guardForDate(date, config) {
 if (!config || !isCalendarDate(date) || new Date(date + 'T12:00:00Z').getUTCDay() !== 6) return null
 const versions = [...(config.previousRotations || []), config]
 const selected = versions.filter(v => (v.effectiveFrom || date.slice(0, 4) + '-01-01') <= date).sort((a,b) => String(a.effectiveFrom || '').localeCompare(String(b.effectiveFrom || ''))).at(-1)
 const rotation = (selected?.rotation || []).filter(item => item?.technicianId || item?.name)
 if (!rotation.length) return null
 const startDate = selected.startDate || firstSaturday(date.slice(0,4))
 if (!isCalendarDate(startDate)) return null
 const start = Date.parse(`${startDate}T12:00:00Z`)
 const weeks = Math.round((Date.parse(`${date}T12:00:00Z`) - start) / WEEK)
 const earliest = date < startDate ? date : startDate
 if (rotation.every(entry => guardEligibleOnDate(entry, earliest))) return rotation[((weeks % rotation.length) + rotation.length) % rotation.length]

 // Continue after the last assigned technician, skipping only the entries
 // unavailable on each Saturday. Filtering and then applying a date modulo
 // would move everyone's position when a new technician becomes eligible.
 const direction = weeks < 0 ? -1 : 1
 let cursor = weeks < 0 ? rotation.length - 1 : 0, assigned = null
 for (let week = weeks < 0 ? -1 : 0; direction > 0 ? week <= weeks : week >= weeks; week += direction) {
  const day = new Date(start + week * WEEK).toISOString().slice(0, 10)
  assigned = null
  for (let scanned = 0; scanned < rotation.length; scanned += 1) {
   const index = ((cursor + scanned * direction) % rotation.length + rotation.length) % rotation.length
   if (!guardEligibleOnDate(rotation[index], day)) continue
   assigned = rotation[index]
   cursor = (index + direction + rotation.length) % rotation.length
   break
  }
 }
 return assigned
}
module.exports = { guardForDate, firstSaturday }
