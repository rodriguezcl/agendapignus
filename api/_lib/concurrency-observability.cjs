const ALLOWED_EVENTS = new Set(['state_write_merged', 'state_write_conflict'])

function normalizedRevision(value) {
  const revision = Number(value)
  return Number.isInteger(revision) && revision >= 0 ? revision : null
}

function stateConcurrencyEvent(event, details = {}, now = new Date()) {
  if (!ALLOWED_EVENTS.has(event)) throw new Error(`Evento de concurrencia desconocido: ${event}`)
  return {
    timestamp: now.toISOString(),
    scope: 'state_concurrency',
    event,
    code: String(details.code || (event === 'state_write_merged' ? 'STATE_WRITE_MERGED' : 'STATE_WRITE_CONFLICT')),
    actorRole: String(details.actorRole || 'unknown'),
    expectedRevision: normalizedRevision(details.expectedRevision),
    currentRevision: normalizedRevision(details.currentRevision),
    conflictPath: details.conflictPath ? String(details.conflictPath).slice(0, 240) : null
  }
}

function logStateConcurrencyEvent(event, details = {}, writer = console.info) {
  const record = stateConcurrencyEvent(event, details)
  writer(JSON.stringify(record))
  return record
}

module.exports = { logStateConcurrencyEvent, stateConcurrencyEvent }
