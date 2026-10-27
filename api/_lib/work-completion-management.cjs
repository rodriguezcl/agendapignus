const permissions = require('./permission-catalog.cjs')
const access = require('./granular-read-policy.cjs')
function manageWorkCompletion(state, input, user, now = new Date().toISOString()) {
  const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }) }
  const before = state.history.find(r => String(r.id) === String(input.recordId))
  if (!permissions.can(user, 'history.edit') || !before || !access.serviceWritable(before, user, state)) fail('No tenés permiso para gestionar los trabajos pendientes.', 403)
  if (!before.workCompletion?.items.some(r => r.status === 'pending') || before.workCompletion.at !== input.reportedAt || before.workCompletion.management) fail('El informe cambió o sus pendientes ya fueron gestionados. Actualizá el detalle.', 409)
  const note = String(input.note || '').trim()
  if (!note || note.length > 1000) fail('Indicá cómo se gestionaron los trabajos pendientes (hasta 1000 caracteres).', 400)
  const after = { ...before, workCompletion: { ...before.workCompletion, management: { at: now, byId: user.id, byName: user.name, note } } }
  return { before, after, state: { ...state, history: state.history.map(r => r === before ? after : r) } }
}
module.exports = { manageWorkCompletion }
