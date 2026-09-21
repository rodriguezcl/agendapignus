import { stateOperations } from './state-operations.mjs'
import { serviceRecordFingerprint } from '../../../domain/history/service-concurrency.mjs'
import { canChangeServiceConfirmation } from '../../../domain/agenda/service-confirmation.mjs'

export function serviceConfirmationOperations(snapshot, { base, awaitingConfirmation, today }) {
  const record = snapshot.history.find(item => String(item.id) === String(base.id))
  if (!record || serviceRecordFingerprint(record) !== serviceRecordFingerprint(base)) throw new Error('El servicio cambió. Actualizá la agenda antes de confirmar.')
  if (!canChangeServiceConfirmation(record)) throw new Error('Este servicio ya tiene gestión o es un control vehicular; no admite cambiar su confirmación.')
  if (record.date < today) throw new Error('El día del servicio ya pasó. Reprogramalo antes de confirmarlo.')
  const next = { ...record, awaitingConfirmation }
  const sync = value => {
    if (Array.isArray(value)) return value.map(sync)
    if (!value || typeof value !== 'object') return value
    const match = (value.historyId != null && String(value.historyId) === String(record.id)) || (record.sourceTaskId && String(value.taskId || '') === String(record.sourceTaskId))
    return Object.fromEntries(Object.entries(match ? { ...value, awaitingConfirmation } : value).map(([key, item]) => [key, sync(item)]))
  }
  return stateOperations(snapshot, { ...snapshot, history: snapshot.history.map(item => item === record ? next : item), agenda: sync(snapshot.agenda) })
}
