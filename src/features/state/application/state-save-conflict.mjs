export const STATE_REVISION_CONFLICT = 'STATE_REVISION_CONFLICT'

export const STATE_REVISION_CONFLICT_NOTICE = 'No se guardó el último cambio porque otra sesión había actualizado la información. La pantalla ya muestra el estado real; volvé a realizar la acción.'

export const isStateRevisionConflict = error => Boolean(
  error?.status === 409 && (!error.payload?.code || error.payload.code === STATE_REVISION_CONFLICT)
)

export async function recoverStateRevisionConflict(error, {
  invalidatePendingSaves,
  loadRemoteState,
  applyRemoteState,
  notify,
  cancelled = () => false
}) {
  if (!isStateRevisionConflict(error)) return false

  // Se invalida antes de consultar el servidor: cualquier guardado que ya
  // estuviera encolado fue construido sobre la misma revisión obsoleta.
  invalidatePendingSaves()
  try {
    const remoteState = await loadRemoteState()
    if (!cancelled()) {
      applyRemoteState(remoteState)
      notify(STATE_REVISION_CONFLICT_NOTICE)
    }
    return true
  } catch {
    return false
  }
}
