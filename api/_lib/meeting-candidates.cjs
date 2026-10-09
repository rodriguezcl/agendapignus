const { normalizedShadowIsPrepared } = require('./operational-storage.cjs')
const { readStorageControl } = require('./storage-control.cjs')
const { storageMode } = require('./storage-router.cjs')

// A small projection is sufficient for the existing completion policy. Only
// when it finds an expired meeting do we read the full state under the lock.
async function readMeetingCandidates(sql) {
  const normalized = storageMode() === 'persistent' && await normalizedShadowIsPrepared(sql) &&
    (await readStorageControl(sql)).model === 'normalized'
  const table = normalized ? 'normalized_shadow.history_evidence' : 'pignus_work_history'
  const column = normalized ? 'original_payload' : 'data'
  const keys = ['id', 'service', 'date', 'status', 'awaitingConfirmation', 'vehicleControl', 'completedAt', 'technicalStatus', 'technicianRequest', 'scheduledDate']
  const projection = keys.map(key => `'${key}', ${column}->'${key}'`).join(', ')
  const result = await sql.unsafe(`select jsonb_build_object(${projection}) as data from ${table}
    where coalesce(nullif(${column}->>'status', ''), 'Pendiente') in ('Pendiente', 'En proceso', 'Iniciado')
    and lower(${column}->>'service') like '%mensual%'
    and ${column}->>'date' <= to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')`)
  return result.map(row => row.data)
}
module.exports = { readMeetingCandidates }
