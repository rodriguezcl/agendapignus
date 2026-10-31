const notice = require('./appointment-notice.cjs')
const DAY = 24 * 60 * 60 * 1000
const pending = ['queued', 'retry', 'needs_email', 'needs_phone', 'skipped', 'needs_action']
const communicated = ['sent', 'verified', 'sending', 'uncertain', 'accepted', 'processed', 'reviewed']
const key = item => item.appointmentKey || item.scheduleKey?.slice(0, -17) || item.serviceId
const destination = (item, channel) => channel === 'whatsapp' ? item.phone : item.recipient
const sameVisit = (a, b) => key(a) === key(b) && a.customerId === b.customerId
const start = item => Date.parse(`${item.date}T${item.time}:00-03:00`)

// A genuine edit may return to an already communicated date. Give that edit
// its own receipt while retaining the logical visit identity.
function revision(item, rows, at) {
  if (item.kind !== 'appointment' || item.cancelledNotice) return item
  const existing = rows.find(row => row.id === item.id)
  const latest = rows.filter(row => row.payload.kind === 'appointment' && sameVisit(item, row.payload))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (latest && !latest.payload.cancelledNotice && latest.payload.scheduleKey === item.scheduleKey) return { ...item, id: latest.id }
  return existing && communicated.includes(existing.status)
    ? { ...item, id: notice.hash(`appointment-update:${item.id}:${at}`) } : item
}

// A fixed UTC-03:00 offset is the Argentine appointment timezone, independent
// of the worker host timezone. The queue, never a GHL wait, owns this deadline.
function plan(item, rows, at, channel) {
  const existing = rows.find(row => row.id === item.id)
  const prior = rows.find(row => row.payload.kind === 'appointment' && !row.payload.cancelledNotice && sameVisit(item, row.payload) &&
    destination(item, channel) && destination(item, channel) === destination(row.payload, channel) && communicated.includes(row.status))
  const saved = existing && pending.includes(existing.status) && existing.status !== 'cancelled' && existing.payload.timingVersion === 1 ? existing.payload : null
  const confirmedAt = saved?.confirmedAt || at
  const immediate = saved?.immediateUpdate || Boolean(prior && prior.id !== item.id)
  const due = start(item) - DAY
  const skipped = !Number.isFinite(due) || (!immediate && Date.parse(confirmedAt) > due)
  const scheduledAt = immediate ? saved?.scheduledAt || at : Number.isFinite(due) ? new Date(due).toISOString() : at
  const payload = { ...item, timingVersion: 1, confirmedAt, scheduledAt, immediateUpdate: immediate,
    omissionReason: skipped ? 'La visita se confirmó con menos de 24 horas de anticipación.' : '' }
  return { payload, status: skipped ? 'skipped' : destination(item, channel) ? 'queued' : channel === 'whatsapp' ? 'needs_phone' : 'needs_email', nextAt: scheduledAt }
}

function current(record, item, state, channel, at) {
  if (item.technicalCancellation) return record?.status === 'Cancelado' && record.technicalStatus === 'Cancelado' && record.technicalReportedAt === item.cancellationReportedAt
  if (item.cancelledNotice) return !record || record.status === 'Cancelado'
  if (!notice.ready(record, state) || start(item) <= new Date(at).getTime()) return false
  const latest = notice.envelope(record, state)
  return latest.scheduleKey === item.scheduleKey && latest.customerId === item.customerId &&
    destination(latest, channel) === destination(item, channel) && (channel !== 'whatsapp' || latest.recipient === item.recipient)
}

// Reconcile pending rows before claiming, including rows created by an older
// release. Preserve sent/ambiguous receipts and retry backoff; never backfill.
async function reconcile({ rows, state, at, channel, save }) {
  for (const row of rows) {
    if (row.payload.kind !== 'appointment' || !pending.includes(row.status)) continue
    const record = state.history.find(item => String(item.id) === row.service_id)
    if (!current(record, row.payload, state, channel, at)) {
      await save(row, { status: 'cancelled', payload: row.payload, nextAt: row.next_attempt_at })
      continue
    }
    if (row.payload.cancelledNotice) {
      if (channel === 'email' && row.payload.technicalCancellation && row.status === 'needs_email') {
        await save(row, { status: 'needs_action', payload: { ...row.payload, manualContact: true }, nextAt: row.next_attempt_at })
      }
      continue
    }
    const planned = plan({ ...row.payload, ...notice.envelope(record, state), id: row.id }, rows, row.payload.timingVersion ? at : row.created_at, channel)
    if (row.status === 'retry' && planned.status === 'queued') planned.status = 'retry'
    if (row.attempts > 0 && row.next_attempt_at > planned.nextAt) planned.nextAt = row.next_attempt_at
    if (row.status !== planned.status || row.next_attempt_at !== planned.nextAt || JSON.stringify(row.payload) !== JSON.stringify(planned.payload)) await save(row, planned)
  }
}

function cancellations(previous, next, rows, at, channel) {
  const old = new Map((previous.history || []).map(record => [String(record.id), record]))
  const seen = new Set()
  // A technician reports a visit that could not be carried out. Contact the
  // customer even after its scheduled time and without an earlier reminder.
  const technical = channel === 'email' ? (next.history || []).flatMap(record => {
    const before = old.get(String(record.id))
    if (!before || before.status === 'Cancelado' || record.status !== 'Cancelado' || record.technicalStatus !== 'Cancelado' ||
      !record.technicalReportedAt || !record.technicalReportedById || !notice.installation(record) || before.status === 'Completado') return []
    const item = notice.envelope(record, next)
    const payload = { ...item, id: notice.hash(`technical-cancellation:${record.id}:${record.technicalReportedAt}`),
      cancelledNotice: true, technicalCancellation: true, cancellationReportedAt: record.technicalReportedAt, manualContact: !item.recipient,
      immediateUpdate: true, scheduledAt: at, timingVersion: 1 }
    return [{ payload, status: item.recipient ? 'queued' : 'needs_action', nextAt: at }]
  }) : []
  const communicatedCancellations = rows.filter(row => row.payload.kind === 'appointment' && !row.payload.cancelledNotice && communicated.includes(row.status) && destination(row.payload, channel)).flatMap(row => {
    const before = old.get(row.service_id), record = (next.history || []).find(item => String(item.id) === row.service_id)
    if (technical.some(item => item.payload.serviceId === row.service_id)) return []
    if (channel === 'whatsapp' && record?.technicalStatus === 'Cancelado' && record.technicalReportedAt && record.technicalReportedById && !notice.envelope(record, next).recipient) return []
    if (!before || before.status === 'Cancelado' || record && record.status !== 'Cancelado') return []
    if (before.status === 'Completado' || start(row.payload) <= Date.parse(at)) return []
    // Removing/replacing the first leg of a journey is not cancelling the visit.
    if (before.serviceJourney && next.history.some(item => item.serviceJourney?.id === before.serviceJourney.id && !['Cancelado', 'Reprogramado'].includes(item.status))) return []
    const dedup = `${key(row.payload)}:${destination(row.payload, channel)}`
    if (seen.has(dedup)) return []
    seen.add(dedup)
    const payload = { ...row.payload, id: notice.hash(`appointment-cancelled:${row.id}`), cancelledNotice: true, immediateUpdate: true, scheduledAt: at, timingVersion: 1 }
    return [{ payload, status: channel === 'whatsapp' ? 'needs_action' : 'queued', nextAt: at }]
  })
  return [...technical, ...communicatedCancellations]
}

module.exports = { plan, reconcile, cancellations, current, start, revision }
