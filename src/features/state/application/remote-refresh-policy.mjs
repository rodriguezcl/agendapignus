import { stateOperations } from './state-operations.mjs'

export const REMOTE_EDIT_NOTICE = 'Hay cambios guardados desde otra sesión. Tenés una edición en curso: guardala o cancelala para actualizar la información.'
export function hasPendingStateChanges(current, baseline) {
  if (current === baseline) return false
  if (!current || !baseline) return true
  try { return stateOperations(JSON.parse(baseline), JSON.parse(current)).length > 0 }
  catch { return true }
}
export function canRefreshRemote({ saving = false, draft = false, current, baseline }) {
  return !saving && !draft && !hasPendingStateChanges(current, baseline)
}
