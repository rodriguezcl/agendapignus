const { fingerprint } = require('./normalization-analysis.cjs')

function assertSaveActor(input, user) {
  if (Object.hasOwn(input, 'expectedActorId') && String(input.expectedActorId) !== String(user.id)) {
    throw Object.assign(new Error('La cuenta de la sesión cambió. Volvé a abrir la agenda con tu cuenta antes de guardar.'), { statusCode: 403, code: 'SAVE_ACTOR_CHANGED' })
  }
}

function serviceCreationReceipt(operations, user) {
  if (!Array.isArray(operations) || !user?.id) return null
  const ids = operations.filter(op => op?.existed === false && op.exists === true &&
    op.path?.length === 2 && op.path[0] === 'history' && op.path[1]?.key === 'id' &&
    typeof op.mirrorWeeklyTaskId === 'string' && op.mirrorWeeklyTaskId &&
    op.mirrorWeeklyTaskId === (op.after?.sourceTaskId || op.after?.taskId) &&
    typeof op.path[1].id === 'string' && op.path[1].id && String(op.after?.id) === op.path[1].id)
    .map(op => op.path[1].id).sort()
  if (!ids.length) return null
  return { key: 'service_creation:' + fingerprint(ids), digest: fingerprint([String(user.id), operations]), ids }
}

function assertCreationReplay(receipt, storedDigest, history) {
  const present = new Set(history.map(record => String(record.id)))
  if (storedDigest !== receipt.digest || !receipt.ids.every(id => present.has(id))) {
    throw Object.assign(new Error('El alta ya fue procesada y no coincide con la solicitud actual, o el servicio fue eliminado. Revisá la agenda actualizada.'), { statusCode: 409, code: 'RECORD_WRITE_CONFLICT' })
  }
}

module.exports = { assertSaveActor, serviceCreationReceipt, assertCreationReplay }
