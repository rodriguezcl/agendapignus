import completion from '../../../../api/_lib/service-completion.cjs'
import { permittedPlanningPatch } from '../../agenda/application/planning-permissions.mjs'

export function canCompleteHistoryRecord(record, can, now) {
  if ((record.serviceTypes || []).length > 1) return false
  if (!can('history.complete') || record.vehicleControl || record.awaitingConfirmation === true) return false
  if (can('history.completeEarly')) return true
  try { completion.assertServiceCanBeCompleted(record, now); return true } catch { return false }
}

export function historyStatusPermission(status) {
  return { Completado: 'history.complete', 'Avance registrado': 'history.complete', Pendiente: 'history.reopen', Cancelado: 'history.cancel', Reprogramado: 'planning.reschedule' }[status]
}

export function permittedHistoryEditPatch({ record, initialDraft, draft, customerPatch = {}, servicePatch = {} }, can) {
  const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(initialDraft[key])))
  const patch = permittedPlanningPatch({ ...changed, ...customerPatch, ...servicePatch }, {
    existing: true, task: record, can: key => can(key === 'planning.edit' ? 'history.edit' : key)
  })
  if (can(record.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')) Object.assign(patch, customerPatch)
  // A historical record without a linked customer keeps editable contact
  // fields of its own. Updating those fields does not relink an account.
  if (!record.customerId && !record.subscriberReservation && can('history.edit')) {
    for (const key of ['address', 'phone']) if (Object.hasOwn(changed, key)) patch[key] = changed[key]
  }
  return patch
}
