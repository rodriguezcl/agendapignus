export function countYearToDateCompletedRecords(records, { throughDate, matches = () => true }) {
  const year = String(throughDate || '').slice(0, 4)
  if (!/^\d{4}$/.test(year) || typeof matches !== 'function') return 0

  const firstDay = `${year}-01-01`
  return (records || []).filter(record => {
    const date = String(record?.date || '')
    return date >= firstDay
      && date <= throughDate
      && record?.status === 'Completado'
      && matches(record)
  }).length
}

export function countYearToDateAlarmInstallations(records, { throughDate, zone = 'docta', isAlarmRecord, zoneOf }) {
  if (typeof isAlarmRecord !== 'function' || typeof zoneOf !== 'function') return 0
  return countYearToDateCompletedRecords(records, {
    throughDate,
    matches: record => isAlarmRecord(record) && zoneOf(record) === zone
  })
}
