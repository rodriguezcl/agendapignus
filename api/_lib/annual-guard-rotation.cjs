const firstSaturday = year => {
 const date = new Date(year + '-01-01T12:00:00Z')
 date.setUTCDate(date.getUTCDate() + (6 - date.getUTCDay() + 7) % 7)
 return date.toISOString().slice(0, 10)
}
function guardForDate(date, config) {
 if (!config || new Date(date + 'T12:00:00Z').getUTCDay() !== 6) return null
 const versions = [...(config.previousRotations || []), config]
 const selected = versions.filter(v => (v.effectiveFrom || date.slice(0, 4) + '-01-01') <= date).sort((a,b) => String(a.effectiveFrom || '').localeCompare(String(b.effectiveFrom || ''))).at(-1)
 const rotation = (selected?.rotation || []).filter(item => item?.technicianId || item?.name)
 if (!rotation.length) return null
 const weeks = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse((selected.startDate || firstSaturday(date.slice(0,4))) + 'T12:00:00Z')) / 604800000)
 return rotation[((weeks % rotation.length) + rotation.length) % rotation.length]
}
module.exports = { guardForDate, firstSaturday }
