import { collectionRecords, collectionConfirmed, collectionMoney } from '../collections/collections.mjs'
import { dashboardPendingGroups } from './dashboard-metrics.mjs'
import { isAdvanceRequestActive } from '../agenda/advance-request-active.mjs'
import { reservationFormReady } from '../agenda/reservation-form-ready.mjs'
import { compareReservationReminders } from '../agenda/reservation-reminder-order.mjs'
import { reservationLocality } from '../agenda/service-locality.mjs'
import { softguardVerificationCases } from '../customers/softguard-verification.mjs'

export const DASHBOARD_PENDING_NOTICES = [
  { key: 'today', title: 'Pendientes de gestión', detail: 'Servicios de hoy que todavía requieren gestión.', tone: 'warning' },
  { key: 'confirmation', title: 'Pendientes de confirmación', detail: 'Esperan la aprobación del cliente. Reservan su horario, pero no aparecen en la agenda del técnico.', tone: 'info' },
  { key: 'rescheduling', title: 'Pendientes de reprogramación', detail: 'El técnico ya informó su gestión. Falta definir una nueva fecha en Historial; no bloquean su siguiente servicio.', tone: 'warning' },
  { key: 'overdue', title: 'Pendientes de días anteriores', detail: 'Servicios anteriores que todavía requieren una definición.', tone: 'danger' }
]

function nextCalendarDay(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) return ''
  const day = new Date(`${today}T12:00:00Z`)
  if (!Number.isFinite(day.getTime())) return ''
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

function dateLabel(value) {
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })
    : 'Fecha a confirmar'
}

export function dashboardReservationRecords(history = [], today) {
  const through = nextCalendarDay(today)
  return history.filter(record => record.subscriberReservation
    && (reservationFormReady(record) || (through && String(record.date || '') <= through))
    && !['Completado', 'Cancelado'].includes(record.status)).sort(compareReservationReminders)
}

export function dashboardExpiredInsuranceVehicles(vehicles = [], today) {
  return vehicles.filter(vehicle => Boolean(vehicle?.insuranceExpiresOn && vehicle.insuranceExpiresOn < today))
}

/**
 * A read-only snapshot of active operational notices for the notification bell.
 * The caller supplies the current calendar date/instant and existing password
 * request state: this selector performs no requests, mutation or clock reads.
 * Targets describe navigation only; resolution remains in the existing modules.
 */
export function selectDashboardNotifications({ history = [], vehicles = [], customers = [], passwordResetRequests = [], today, now, isAdministrator = false, permissions = {} } = {}) {
  const notices = (isAdministrator || permissions.collections === true) ? collectionRecords(history).filter(record => !collectionConfirmed(record)).map(record => ({
    id: `collection:${record.id}`, title: 'Cobranza pendiente de pago', tone: 'warning',
    detail: `${record.client || 'Servicio'} · ${dateLabel(record.date)} · ${collectionMoney(record.amount)} · ${record.paymentMethod}.`,
    target: { type: 'collection', recordId: String(record.id) }
  })) : []
  if (!isAdministrator && permissions.dashboard !== true) return notices
  const can = module => isAdministrator || permissions[module] === true
  const dashboard = (section, id) => ({ type: 'dashboard', section, ...(id == null ? {} : { id: String(id) }) })

  if (isAdministrator) {
    for (const record of history.filter(item => isAdvanceRequestActive(item, now ?? Number.NaN))) {
      notices.push({
        id: `advance:${record.id}`, title: 'Solicitud para adelantar servicio', tone: 'warning',
        detail: `${record.advanceRequest.requestedByName || 'Un técnico'} solicita adelantar el servicio de ${record.client || 'un cliente'} antes de las ${record.advanceRequest.scheduledTime || record.time}.`,
        target: { type: 'advance-request', recordId: String(record.id) }
      })
    }
    for (const request of passwordResetRequests) {
      notices.push({
        id: `password:${request.id}`, title: 'Solicitud de cambio de contraseña', tone: 'warning',
        detail: `${request.email} solicita actualizar su contraseña.`,
        target: { type: 'password-reset', requestId: String(request.id) }
      })
    }
  }

  for (const vehicle of dashboardExpiredInsuranceVehicles(vehicles, today)) {
    notices.push({
      id: `insurance:${vehicle.id}`, title: 'Seguro vehicular desactualizado', tone: 'danger',
      detail: `${[vehicle.brand, vehicle.model].filter(Boolean).join(' ')} · ${vehicle.plate} venció el ${dateLabel(vehicle.insuranceExpiresOn)}. ${isAdministrator ? 'Actualizá la documentación del vehículo.' : 'Solicitá el nuevo PDF al área administrativa.'}`,
      target: can('vehicles') ? { type: 'vehicle', vehicleId: String(vehicle.id), edit: isAdministrator } : dashboard('insurance', vehicle.id)
    })
  }

  for (const record of dashboardReservationRecords(history, today)) {
    const ready = reservationFormReady(record)
    notices.push({
      id: `reservation:${record.id}`, title: 'Reserva pendiente de vincular con un PIG', tone: ready ? 'info' : 'warning',
      detail: `${record.client || 'Reserva de abonado'} · ${reservationLocality(record, customers)} · ${dateLabel(record.date)} a las ${record.time || record.scheduledTime || 'hora a confirmar'}. Seleccioná el abonado importado antes del servicio.${ready ? ` Formulario completo disponible para crear el abonado en SoftGuard. Email del formulario: ${record.formEmail.trim()}.` : ''}`,
      target: can('weekly') ? { type: 'reservation', recordId: String(record.id) } : dashboard('reservation', record.id)
    })
  }

  const pending = dashboardPendingGroups(history, today)
  for (const group of DASHBOARD_PENDING_NOTICES) {
    if (!pending[group.key].length) continue
    notices.push({
      id: `pending:${group.key}`, title: `${group.title}: ${pending[group.key].length} servicio(s)`,
      detail: group.detail, tone: group.tone,
      target: can('history') ? { type: 'history', pendingGroup: group.key, date: today } : dashboard(`pending-${group.key}`)
    })
  }

  const verification = softguardVerificationCases(customers)
  if (verification.length) notices.push({
    id: 'softguard-verification', title: `Pendiente de verificación en SoftGuard: ${verification.length} cuenta(s)`,
    detail: 'Hay cuentas PIG que coinciden con clientes CLI provenientes de una baja de servicio.', tone: 'warning',
    target: { type: 'softguard' }
  })
  return notices
}
