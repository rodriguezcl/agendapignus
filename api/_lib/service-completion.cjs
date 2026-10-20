const serviceIsCompleted = record => record?.status === 'Completado' || record?.technicalStatus === 'Completado'

function assertServiceCanBeCompleted(record, now = new Date().toISOString()) {
  const instant = new Date(now)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const serviceDate = String(record?.date || '')
  if (serviceDate > today) { const error = new Error('No se puede completar un servicio antes de su fecha y hora programadas.'); error.statusCode = 409; throw error }
  if (serviceDate !== today) return
  const match = String(record?.time || record?.scheduledTime || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return
  const scheduled = Number(match[1]) * 60 + Number(match[2])
  const current = Number(parts.hour) * 60 + Number(parts.minute)
  if (scheduled > current) { const error = new Error('No se puede completar un servicio antes de su fecha y hora programadas.'); error.statusCode = 409; throw error }
}

function normalizeHistoryCompletionTimes(history = [], previousHistory = [], now = new Date().toISOString(), { allowEarlyCompletion = false } = {}) {
  const previousById = new Map((previousHistory || []).map(record => [String(record.id), record]))
  return (history || []).map(record => {
    const previous = previousById.get(String(record.id))
    const wasCompleted = serviceIsCompleted(previous)
    const isCompleted = serviceIsCompleted(record)
    if (!isCompleted) {
      if (!wasCompleted && !record.completedAt) return record
      const { completedAt: _discardedCompletedAt, ...withoutCompletion } = record
      return withoutCompletion
    }
    if (!previous || !wasCompleted) {
      if (!allowEarlyCompletion) assertServiceCanBeCompleted(record, now)
      return { ...record, completedAt: now }
    }
    if (previous.completedAt) return { ...record, completedAt: previous.completedAt }
    const { completedAt: _discardedLegacyCompletion, ...legacyRecord } = record
    return legacyRecord
  })
}

module.exports = { serviceIsCompleted, assertServiceCanBeCompleted, normalizeHistoryCompletionTimes }
