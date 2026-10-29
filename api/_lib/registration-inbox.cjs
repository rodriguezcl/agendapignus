// Read-only reconciliation. A display match never changes tickets or agenda data.
const policy = require('./permission-catalog.cjs')
const access = require('./granular-read-policy.cjs')
const email = value => String(value || '').trim().toLowerCase()
const groupKey = record => record.serviceJourney?.id ? `journey:${record.serviceJourney.id}` : `service:${record.id}`
const installation = record => [record.service, record.serviceType, ...(record.serviceTypes || []).map(s => s.name)].some(value => /instalacion de alarmas?/.test(String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))
function legacyItems(state, user, tickets, nativeRows = []) {
  if (!policy.can(user, 'forms.view') || !policy.can(user, 'registration.read') || !policy.can(user, 'records.contact')) return []
  const groups = new Map()
  for (const record of state.history || []) {
    if (!installation(record)) continue
    const key = groupKey(record)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  const accessible = record => access.serviceInReadScope(record, user, state) && (!access.customerForRecord(record, state) || access.customerReadable(access.customerForRecord(record, state), user, state))
  const rows = new Map()
  const nativeIds = new Set(nativeRows.map(row => row.id))
  const nativeServices = new Set(nativeRows.map(row => row.service_id))
  for (const [key, visits] of groups) {
    visits.sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)))
    const record = visits.find(r => r.status !== 'Cancelado') || visits[0]
    // Do not leak other visits through a grouped record.
    if (!visits.every(accessible) || nativeIds.has(key) || visits.some(r => nativeServices.has(String(r.id)))) continue
    const complete = visits.some(r => r.form === 'Completo' && email(r.formEmail))
    if (!complete) continue
    const customer = access.customerForRecord(record, state)
    rows.set(key, { id:`legacy:${key}`, source:'google', kind:record.installationZone || '', client:record.client || record.clientNameAtService || 'Instalación', account:customer?.account || record.account || '', serviceId:String(record.id), recordIds:visits.map(r => String(r.id)), date:record.date, time:record.time, email:record.formEmail || visits.find(r => r.formEmail)?.formEmail || '', status:visits.every(r => r.status === 'Cancelado') ? 'cancelled' : record.subscriberReservation ? 'submitted' : 'reviewed', tickets:[], match:'service', updatedAt:record.date || '' })
  }
  for (const ticket of tickets) {
    const info = ticket.form
    const address = email(info.email || (!info.multiple && info.candidates?.length === 1 ? info.candidates[0] : ''))
    let key = ''
    if (info.serviceId) {
      key = [...groups].find(([, visits]) => visits.some(r => String(r.id) === String(info.serviceId)))?.[0] || ''
      // A linked but unreadable/native service must not be guessed onto another case.
      // Keep its authorized ticket visible, without exposing that service.
      if (!rows.has(key)) key = ''
    } else if (address && !info.multiple) {
      // Uniqueness is checked against all services, not just the user's scope.
      const matches = [...groups].filter(([, visits]) => visits.some(r => email(r.formEmail) === address && r.form === 'Completo' && r.installationZone === info.kind))
      if (matches.length === 1 && rows.has(matches[0][0])) key = matches[0][0]
    }
    if (!key) {
      key = `ticket:${ticket.id}`
      rows.set(key, {id:`legacy:${key}`, source:'google', kind:info.kind, client:address || 'Formulario de Google · correo por identificar', email:address, account:'', serviceId:'', recordIds:[], date:'', time:'', status:ticket.status === 'Resuelto' ? 'reviewed' : 'submitted', tickets:[], match:'unlinked', updatedAt:ticket.updatedAt})
    }
    const row = rows.get(key)
    row.tickets.push({id:ticket.id, number:ticket.number, status:ticket.status})
    if (row.status !== 'cancelled' && ticket.status !== 'Resuelto') row.status = 'submitted'
    if (!info.serviceId && row.serviceId) row.match = 'email'
    if (!row.kind) row.kind = info.kind
  }
  return [...rows.values()]
}
function legacyNotices(items) {
  return items.filter(item => item.status === 'submitted').map(item => ({id:`registration:${item.id}`, source:'registration', title:item.match === 'unlinked' ? 'Formulario de Google recibido · vincular instalación' : 'Formulario de Google · gestión pendiente', detail:`${item.client}${item.email && item.email !== item.client ? ' · '+item.email : ''} · ${item.serviceId ? 'Revisá la vinculación del formulario y del PIG.' : 'Identificá la instalación correspondiente.'}`, tone:'info', target:{type:'registration', id:item.id, recordId:item.serviceId}, recordIds:item.recordIds, ticketIds:item.tickets.map(t => t.id)}))
}
module.exports = {legacyItems, legacyNotices}
