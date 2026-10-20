const canPrepare = record => Boolean(record && !record.vehicleControl && !['Cancelado', 'Reprogramado'].includes(record.status))
function applyServicePreparation(state, current, user, allowed, now = new Date().toISOString()) {
  const old = new Map((current.history || []).map(record => [String(record.id), record]))
  const history = (state.history || []).map(record => {
    const previous = old.get(String(record.id))
    const before = previous?.servicePreparation
    const requested = record.servicePreparation
    let preparation = before
    if (allowed && canPrepare(record) && requested && Boolean(requested.ready) !== Boolean(before?.ready)) {
      preparation = { ready: requested.ready === true, byId: String(user.id), byName: user.name || user.email || 'Usuario', at: now }
    }
    if (preparation === requested) return record
    const { servicePreparation: ignored, ...rest } = record
    return preparation ? { ...rest, servicePreparation: preparation } : rest
  })
  const byId = new Map(history.map(record => [String(record.id), record]))
  const byTask = new Map(history.filter(record => record.sourceTaskId).map(record => [String(record.sourceTaskId), record]))
  const sync = value => {
    if (Array.isArray(value)) {
      const result = value.map(sync)
      return result.every((item, index) => item === value[index]) ? value : result
    }
    if (!value || typeof value !== 'object') return value
    const record = value.historyId ? byId.get(String(value.historyId)) : value.taskId ? byTask.get(String(value.taskId)) : null
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sync(item)]))
    if (record) {
      if (JSON.stringify(value.servicePreparation) !== JSON.stringify(record.servicePreparation)) {
        delete result.servicePreparation
        if (record.servicePreparation) result.servicePreparation = record.servicePreparation
      }
    }
    return Object.keys(result).length === Object.keys(value).length && Object.entries(result).every(([key, item]) => item === value[key]) ? value : result
  }
  return { ...state, history, agenda: sync(state.agenda) }
}
module.exports = { canPrepare, applyServicePreparation }
