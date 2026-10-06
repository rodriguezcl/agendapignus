// Sort calendar values directly, without browser timezone conversions.
export function compareReservationReminders(a, b) {
  const date = record => /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') ? record.date : '9999-99-99'
  const time = record => {
    const match = String(record.time || record.scheduledTime || '').match(/^(\d{1,2}):(\d{2})$/)
    return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : 1440
  }
  return date(a).localeCompare(date(b)) || time(a) - time(b)
}
