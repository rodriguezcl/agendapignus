import { serviceRecordFingerprint } from '../../../domain/history/service-concurrency.mjs'
import policy from '../../../../api/_lib/service-preparation.cjs'
export function servicePreparationOperations(snapshot, { base, ready }) {
  const record = snapshot.history.find(item => String(item.id) === String(base.id))
  if (!record || serviceRecordFingerprint(record) !== serviceRecordFingerprint(base)) throw new Error('El servicio cambió. Actualizá la agenda antes de marcarlo.')
  if (!policy.canPrepare(record)) throw new Error('Este servicio no admite cambiar su preparación.')
  // This is one atomic record command. Comparing the whole snapshot would
  // repeatedly serialize the customer directory and every unrelated service.
  return [{
    path: ['history', { key: 'id', id: String(record.id) }],
    before: record,
    after: { ...record, servicePreparation: { ready: ready === true } },
    existed: true,
    exists: true
  }]
}
