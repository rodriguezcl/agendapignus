import { alignOperationBaselines } from '../../state/application/operation-baselines.mjs'
import { serviceRecordFingerprint } from '../../../domain/history/service-concurrency.mjs'
export function alignHistoryWrite(base, record, display, server, revision) {
  if (!base || !server || Number(server.revision) !== Number(revision)) return { base, record }
  const [operation] = alignOperationBaselines([{ path: ['history', { key: 'id', id: String(base.id) }], before: base, after: record, existed: true, exists: Boolean(record) }], display, server)
  if (operation.before === base) return { base, record }
  if (!record) return { base: operation.before, record }
  // Apply only the user's changes, not presentation enrichment, to the saved baseline.
  const proposed = structuredClone(operation.before)
  for (const key of new Set([...Object.keys(base), ...Object.keys(record)])) {
    if (serviceRecordFingerprint(base[key]) === serviceRecordFingerprint(record[key])) continue
    if (Object.hasOwn(record, key)) proposed[key] = record[key]
    else delete proposed[key]
  }
  return { base: operation.before, record: proposed }
}
