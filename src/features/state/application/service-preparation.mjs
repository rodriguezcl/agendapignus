import { stateOperations } from './state-operations.mjs'
import { serviceRecordFingerprint } from '../../../domain/history/service-concurrency.mjs'
import policy from '../../../../api/_lib/service-preparation.cjs'
export function servicePreparationOperations(snapshot, { base, ready }) {
  const record = snapshot.history.find(item => String(item.id) === String(base.id))
  if (!record || serviceRecordFingerprint(record) !== serviceRecordFingerprint(base)) throw new Error('El servicio cambió. Actualizá la agenda antes de marcarlo.')
  if (!policy.canPrepare(record)) throw new Error('Este servicio no admite cambiar su preparación.')
  return stateOperations(snapshot, { ...snapshot, history: snapshot.history.map(item => item === record ? { ...record, servicePreparation: { ready: ready === true } } : item) })
}
