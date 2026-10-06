import { stateOperations } from './state-operations.mjs'

export const REMOTE_EDIT_NOTICE = 'Hay cambios guardados desde otra sesión. Tenés una edición en curso: guardala o cancelala para actualizar la información.'
export function hasPendingStateChanges(current, baseline) {
  if (current === baseline) return false
  if (!current || !baseline) return true
  try { return stateOperations(JSON.parse(baseline), JSON.parse(current)).length > 0 }
  catch { return true }
}
export function canRefreshRemote({ saving = false, draft = false, current, baseline, remote }) {
  if (saving || draft) return false
  if (!hasPendingStateChanges(current, baseline)) return true
  if (!remote) return false
  // A local difference already present on the server is not an unsaved edit.
  // Compare whole changed entities, never silently merge conflicting fields.
  try {
    const incoming = typeof remote === 'string' ? JSON.parse(remote) : remote
    const read = path => path.reduce((value, segment) => typeof segment === 'object'
      ? value?.find?.(item => String(item?.[segment.key]) === String(segment.id))
      : value?.[segment], incoming)
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
    return stateOperations(JSON.parse(baseline), JSON.parse(current)).every(op => {
      const value = read(op.path)
      return op.exists ? JSON.stringify(canonical(value)) === JSON.stringify(canonical(op.after)) : value === undefined
    })
  } catch { return false }
}
