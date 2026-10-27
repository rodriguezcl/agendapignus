import { collectionRecords, collectionConfirmed, collectionVoided, collectionNeedsReview, collectionMoney, collectionService } from '../collections/collections.mjs'
import { dashboardPendingGroups } from './dashboard-metrics.mjs'
import { isAdvanceRequestActive } from '../agenda/advance-request-active.mjs'
import { reservationFormReady } from '../agenda/reservation-form-ready.mjs'
import { compareReservationReminders } from '../agenda/reservation-reminder-order.mjs'
import { reservationLocality } from '../agenda/service-locality.mjs'
import { softguardVerificationCases } from '../customers/softguard-verification.mjs'
import { pendingSoftguardRetirements } from '../customers/softguard-retirement.mjs'
import { canReadRecord } from '../access/record-scope.mjs'
import policy from '../../../api/_lib/permission-catalog.cjs'
import alarmZones from '../../../api/_lib/alarm-zones.cjs'

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

export const dashboardNotificationAccess = user => policy.permissionsWithAliases(user)

// Recheck scopes when a session's role changes while an unsaved draft keeps
// the previous business snapshot in memory. The server remains authoritative.
export function visibleNotificationCustomers(customers = [], history = [], user) {
  if (!policy.isGranular(user)) return customers
  const scope = policy.readScope(user, 'customers')
  if (scope === 'all') return customers
  if (scope === 'cctv') return customers.filter(customer => customer.cctvService === true)
  if (scope !== 'related' || user?.id == null) return []
  const ids = new Set(), accounts = new Set()
  const availableIds = new Set(customers.filter(customer => customer.customerId != null).map(customer => String(customer.customerId)))
  for (const record of history) {
    if (!(record.technicianIds || []).some(id => String(id) === String(user.id))) continue
    if (record.customerId && availableIds.has(String(record.customerId))) { ids.add(String(record.customerId)); continue }
    const account = record.clientAccount || String(record.client || '').trim().split(/\s+/)[0]
    if (account) accounts.add(String(account).trim().toUpperCase())
  }
  return customers.filter(customer => ids.has(String(customer.customerId)) || (customer.account && accounts.has(String(customer.account).trim().toUpperCase())))
}

/**
 * A read-only snapshot of active operational notices for the notification bell.
 * The caller supplies the current calendar date/instant and existing password
 * request state: this selector performs no requests, mutation or clock reads.
 * Targets describe navigation only; resolution remains in the existing modules.
 */
export function selectDashboardNotifications({ history = [], vehicles = [], customers = [], passwordResetRequests = [], today, now, isAdministrator = false, permissions = {}, user } = {}) {
  const subject = isAdministrator ? { ...user, roleCode: 'administrator' } : user || { permissions }
  const administrator = policy.roleCode(subject) === 'administrator'
  const access = dashboardNotificationAccess(subject)
  const can = key => access[key] === true
  const receives = category => administrator || can(`notifications.${category}`)
  history = history.filter(record => administrator || canReadRecord(record, subject, customers))
  // Old in-memory commercial/contact fields must not outlive their permission.
  if (!can('records.financial') || !can('records.contact')) history = history.map(record => ({ ...record, form: undefined, formEmail: undefined }))
  const visibleCustomers = visibleNotificationCustomers(customers, history, subject)
  const collectionDate = record => collectionService(record, history)?.date
  const notices = receives('collections') ? collectionRecords(history).filter(record => (!collectionConfirmed(record) || collectionNeedsReview(record)) && !collectionVoided(record) && collectionDate(record) && collectionDate(record) <= today).map(record => ({
    id: `collection:${record.id}`, title: collectionNeedsReview(record) ? 'Revisar importe: quedaron trabajos pendientes' : 'Cobranza pendiente de pago', tone: 'warning',
    detail: `${record.client || 'Servicio'} · ${dateLabel(collectionDate(record))} · ${collectionMoney(record.amount)} · ${record.paymentMethod}.`,
    target: { type: 'collection', recordId: String(record.id) }
  })) : []
  if (receives('rescheduling') && can('history.view')) {
    for (const record of history.filter(r => r.workCompletion?.items.some(item => item.status === 'pending') && (!r.followup || r.followup.status === 'Resuelto') && !r.workCompletion.management)) notices.push({ id: 'pending-work:' + record.id, title: 'Trabajos pendientes de coordinación', detail: record.client + ' · ' + record.workCompletion.items.filter(item => item.status === 'pending').map(item => item.name).join(', '), tone: 'warning', target: { type: 'history', recordId: String(record.id) } })
  }
  if (receives('followups') && can('followups.view')) {
    for (const record of history.filter(item => item.followup && item.followup.status !== 'Resuelto')) notices.push({
      id: `followup:${record.id}`, title: `Seguimiento ${record.followup.status.toLowerCase()}: ${record.followup.type}`, tone: 'warning',
      detail: `${record.client || 'Cliente'} · ${record.followup.description} · Responsable: ${record.followup.assigneeName || 'Sin asignar'}`,
      target: { type: 'followup', recordId: String(record.id) }
    })
  }
  const dashboard = (section, id) => ({ type: 'dashboard', section, ...(id == null ? {} : { id: String(id) }) })
  if (receives('softguard') && can('service.documents.read')) {
    for (const record of history.filter(alarmZones.pendingReport)) notices.push({
      id: `alarm-zones:${record.id}:${record.alarmZones.reportedAt}`, title: 'Zonas disponibles para cargar en SoftGuard', tone: 'info',
      detail: `${record.client || 'Instalación de alarma'} · ${record.alarmZones.zones.length} zona(s) informadas por ${record.alarmZones.reportedByName || 'el técnico'}. Pendiente de registrar la carga en SoftGuard.`,
      target: { type: 'alarm-zones', recordId: String(record.id) }
    })
  }

  if (administrator) {
    for (const record of history.filter(item => isAdvanceRequestActive(item, now ?? Number.NaN))) {
      notices.push({
        id: `advance:${record.id}`, soundKeys: [`advance:${record.id}:${record.advanceRequest.requestedAt}`], title: 'Solicitud para adelantar servicio', tone: 'warning',
        detail: `${record.advanceRequest.requestedByName || 'Un técnico'} solicita adelantar el servicio de ${record.client || 'un cliente'} antes de las ${record.advanceRequest.scheduledTime || record.time}.`,
        target: { type: 'advance-request', recordId: String(record.id) }
      })
    }
  }
  if (receives('passwordRequests')) {
    for (const request of passwordResetRequests) {
      notices.push({
        id: `password:${request.id}`, title: 'Solicitud de cambio de contraseña', tone: 'warning',
        detail: `${request.email} solicita actualizar su contraseña.`,
        target: { type: 'password-reset', requestId: String(request.id) }
      })
    }
  }

  for (const vehicle of receives('insurance') ? dashboardExpiredInsuranceVehicles(vehicles, today) : []) {
    notices.push({
      id: `insurance:${vehicle.id}`, title: 'Seguro vehicular desactualizado', tone: 'danger',
      detail: `${[vehicle.brand, vehicle.model].filter(Boolean).join(' ')} · ${vehicle.plate} venció el ${dateLabel(vehicle.insuranceExpiresOn)}. ${can('vehicle.insurance.write') ? 'Actualizá la documentación del vehículo.' : 'Solicitá el nuevo PDF al área administrativa.'}`,
      target: { type: 'vehicle', vehicleId: String(vehicle.id), edit: can('vehicle.insurance.write') }
    })
  }

  for (const record of receives('reservations') ? dashboardReservationRecords(history, today) : []) {
    const ready = reservationFormReady(record)
    const locality = can('records.contact') ? ` · ${reservationLocality(record, visibleCustomers)}` : ''
    notices.push({
      id: `reservation:${record.id}`, title: 'Reserva pendiente de vincular con un PIG', tone: ready ? 'info' : 'warning',
      detail: `${record.client || 'Reserva de abonado'}${locality} · ${dateLabel(record.date)} a las ${record.time || record.scheduledTime || 'hora a confirmar'}. ${can('planning.reservation.link') ? 'Seleccioná el abonado importado antes del servicio.' : 'Requiere vinculación con la cuenta definitiva antes del servicio.'}${ready ? ` Formulario completo disponible para crear el abonado en SoftGuard. Email del formulario: ${record.formEmail.trim()}.` : ''}`,
      target: can('weekly') ? { type: 'reservation', recordId: String(record.id) } : dashboard('reservation', record.id)
    })
  }

  const pending = dashboardPendingGroups(history, today)
  const categories = { today: 'pendingToday', confirmation: 'confirmation', rescheduling: 'rescheduling', overdue: 'overdue' }
  for (const group of DASHBOARD_PENDING_NOTICES) {
    if (!receives(categories[group.key]) || !pending[group.key].length) continue
    notices.push({
      id: `pending:${group.key}`, soundKeys: pending[group.key].map(record => `pending:${group.key}:${record.id}`), title: `${group.title}: ${pending[group.key].length} servicio(s)`,
      detail: group.detail, tone: group.tone,
      target: can('history') ? { type: 'history', pendingGroup: group.key, date: today } : dashboard(`pending-${group.key}`)
    })
  }

  for (const customer of receives('softguard') ? pendingSoftguardRetirements(visibleCustomers) : []) {
    notices.push({
      id: `softguard-retirement:${customer.customerId}`, title: 'Baja pendiente en SoftGuard', tone: 'warning',
      detail: `${customer.name} · ${customer.convertedFromAccount}. La baja ya está confirmada en la agenda (${customer.account}). Falta dar de baja la cuenta en SoftGuard y registrar que se realizó.`,
      target: { type: 'softguard-retirement', customerId: String(customer.customerId) }
    })
  }
  const verification = receives('softguard') ? softguardVerificationCases(visibleCustomers) : []
  if (verification.length) notices.push({
    id: 'softguard-verification', soundKeys: verification.map(item => `softguard-verification:${item.customerId || item.account}`), title: `Pendiente de verificación en SoftGuard: ${verification.length} cuenta(s)`,
    detail: 'Hay cuentas PIG que coinciden con clientes CLI provenientes de una baja de servicio.', tone: 'warning',
    target: { type: 'softguard' }
  })
  return notices
}
