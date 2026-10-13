const DAY = 86400000
export function mileageStatistics(history, vehicleId, today) {
  const grouped = new Map()
  let warnings = 0
  for (const row of history) {
    if (!row.vehicleControl || String(row.vehicleId) !== String(vehicleId) || row.vehicleMileage == null || row.vehicleMileage === '' || row.status === 'Cancelado') continue
    if (row.vehicleControlReportedAt && !Number.isFinite(Date.parse(row.vehicleControlReportedAt))) { warnings++; continue }
    const date = row.vehicleControlReportedAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Cordoba' }).format(new Date(row.vehicleControlReportedAt)) : row.date
    const time = Date.parse(date + 'T00:00:00Z'), value = Number(row.vehicleMileage)
    if (!Number.isFinite(time) || !Number.isFinite(value) || value < 0 || date > today) continue
    if (!grouped.has(time)) grouped.set(time, new Set())
    grouped.get(time).add(value)
  }
  const readings = [...grouped].sort(([a], [b]) => a - b)
  const months = new Map()
  let previous = null
  for (const [time, values] of readings) {
    if (values.size !== 1) { warnings++; previous = null; continue }
    const value = [...values][0]
    if (previous && value < previous.value) { warnings++; previous = null; continue }
    if (previous) {
      const daily = (value - previous.value) / ((time - previous.time) / DAY)
      for (let cursor = previous.time; cursor < time;) {
        const d = new Date(cursor), key = d.toISOString().slice(0, 7)
        const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
        const stop = Math.min(time, end), days = (stop - cursor) / DAY
        const item = months.get(key) || { month: key, km: 0, days: 0, totalDays: new Date(end - DAY).getUTCDate() }
        item.km += daily * days; item.days += days; months.set(key, item); cursor = stop
      }
    }
    previous = { time, value }
  }
  const rows = [...months.values()].map(row => ({ ...row, complete: row.days === row.totalDays && row.month < today.slice(0, 7) })).reverse()
  const complete = rows.filter(row => row.complete)
  return { rows, warnings, average: complete.length ? complete.reduce((sum, row) => sum + row.km, 0) / complete.length : null, completeMonths: complete.length }
}
