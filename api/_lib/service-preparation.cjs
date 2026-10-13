const relevant = ['serviceId', 'service', 'serviceTypes', 'detail', 'internalNote', 'internalChecklist', 'customerId', 'address', 'date', 'teamId', 'technicianIds']
const canPrepare = record => Boolean(record && !record.vehicleControl && !record.startedAt && !record.technicalStatus && !['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado'].includes(record.status))
function applyServicePreparation(state, current, user, allowed, now = new Date().toISOString()) {
  const old = new Map((current.history || []).map(record => [String(record.id), record]))
  const history = (state.history || []).map(record => {
    const previous = old.get(String(record.id))
    const before = previous?.servicePreparation
    const requested = record.servicePreparation
    let preparation = before
    const changed = previous && relevant.some(key => JSON.stringify(previous[key] ?? null) !== JSON.stringify(record[key] ?? null))
    if (before?.ready && changed) preparation = { ...before, ready: false, needsReview: true }
    else if (allowed && canPrepare(record) && requested && Boolean(requested.ready) !== Boolean(before?.ready)) {
      preparation = { ready: requested.ready === true, byId: String(user.id), byName: user.name || user.email || 'Usuario', at: now }
    }
    const { servicePreparation: ignored, ...rest } = record
    return preparation ? { ...rest, servicePreparation: preparation } : rest
  })
  const byId = new Map(history.map(record => [String(record.id), record]))
  const byTask = new Map(history.filter(record => record.sourceTaskId).map(record => [String(record.sourceTaskId), record]))
  const sync = value => {
    if (Array.isArray(value)) return value.map(sync)
    if (!value || typeof value !== 'object') return value
    const record = value.historyId ? byId.get(String(value.historyId)) : value.taskId ? byTask.get(String(value.taskId)) : null
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sync(item)]))
    if (record) { delete result.servicePreparation; if (record.servicePreparation) result.servicePreparation = record.servicePreparation }
    return result
  }
  return { ...state, history, agenda: sync(state.agenda) }
}
module.exports = { canPrepare, applyServicePreparation }
