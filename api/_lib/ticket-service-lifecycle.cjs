const { isDeepStrictEqual } = require('node:util')
const d = require('./tickets.cjs')
const read = require('./granular-read-policy.cjs')
const sla = require('./ticket-sla.cjs')
const id = value => String(value || '')
const canceled = record => !record || record.status === 'Cancelado' || record.technicalStatus === 'Cancelado'
const schedule = record => record && ({ id: id(record.id), date: record.date || '', time: record.time || record.scheduledTime || '', team: record.team || '', status: record.status || 'Pendiente', service: record.service || '', journey: record.serviceJourney || null })

function validateTicketEvidence(previous, next, { reportRecordId } = {}) {
  const old = new Map((previous.history || []).map(record => [id(record.id), record]))
  for (const record of next.history || []) {
    const before = old.get(id(record.id))
    if (before?.sourceTicketId && id(before.sourceTicketId) !== id(record.sourceTicketId)) d.fail('La relación con el ticket debe conservarse al editar el servicio.', 409)
    if (before?.sourceTicketId && id(before.ticketNumber) !== id(record.ticketNumber)) d.fail('El número del ticket vinculado no puede modificarse.', 409)
    if (!isDeepStrictEqual(before?.ticketResolution, record.ticketResolution) && id(record.id) !== id(reportRecordId)) d.fail('La resolución del reclamo se confirma desde el informe técnico.', 403)
  }
}

function resolutionEvidence(input, record, user, now, followup) {
  if (input == null) return record.ticketResolution
  if (!input || typeof input.resolved !== 'boolean') d.fail('Indicá si el reclamo asociado quedó resuelto.')
  if (input.resolved && (record.technicalStatus !== 'Completado' || !record.technicalObservation?.trim())) d.fail('La resolución del reclamo requiere un informe técnico completado.')
  if (input.resolved && followup && followup.relation !== 'different') d.fail('El reclamo no puede cerrarse mientras requiere seguimiento del mismo caso.')
  const ticketIds = input.ticketIds ?? (record.sourceTicketId ? [record.sourceTicketId] : [])
  if (!Array.isArray(ticketIds) || ticketIds.length > 30 || ticketIds.some(value => typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) || input.resolved && !ticketIds.length) d.fail('Revisá los tickets asociados antes de confirmar la resolución.')
  return { resolved: input.resolved, ticketIds: [...new Set(ticketIds)], at: now, byId: id(user.id), byName: user.name || 'Técnico', report: record.technicalObservation || '' }
}

function readyToResolve(item, history, acceptedTicketIds = [item.id]) {
  const required = new Set(item.resolutionServiceIds || [])
  if (!required.size) return false
  const records = history.filter(record => required.has(id(record.id)))
  if (records.length !== required.size) return false
  const active = records.filter(record => !canceled(record))
  if (!active.length) return false
  const accepted = new Set(acceptedTicketIds.map(id))
  const evidence = active.filter(record => record.technicalStatus === 'Completado' && record.ticketResolution?.resolved === true && (!record.ticketResolution.ticketIds || record.ticketResolution.ticketIds.some(value => accepted.has(id(value))))).sort((a,b)=>String(b.ticketResolution.at).localeCompare(String(a.ticketResolution.at)))[0]
  if (!evidence) return false
  const groups = new Map()
  for (const record of active) {
    const key = record.serviceJourney?.id || id(record.id)
    const group = groups.get(key) || []; group.push(record); groups.set(key, group)
    if (record.followup && record.followup.status !== 'Resuelto' && record.followup.relation !== 'different' && (!record.followup.createdAt || record.followup.createdAt >= evidence.ticketResolution.at)) return false
    if (record.technicalReportedAt && record.technicalReportedAt > evidence.ticketResolution.at) return false
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.serviceJourney?.index || 1) - (b.serviceJourney?.index || 1))
    const last = group.at(-1)
    if (last.status !== 'Completado' || last.technicalStatus !== 'Completado') return false
    if (group.some(record => !['Completado', 'Avance registrado'].includes(record.status))) return false
    if (last.serviceJourney) {
      const siblings = history.filter(record => record.serviceJourney?.id === last.serviceJourney.id)
      if (siblings.length !== last.serviceJourney.total || siblings.some(record => !canceled(record) && !required.has(id(record.id)))) return false
    }
  }
  return true
}

async function adoptLegacyServiceLinks(q, item, store) {
  if (Array.isArray(item.resolutionServiceIds)) return
  // Antes de separar contexto y visitas a realizar, ambos se guardaban en
  // serviceIds. El evento de vinculación acredita la intención de coordinar;
  // un informe que originó o amplió el reclamo nunca es una obligación nueva.
  const entries = (await q('SELECT data FROM pignus_ticket_entries WHERE ticket_id=?', [item.id])).map(row => JSON.parse(row.data))
  const contextIds = new Set(entries.map(entry => id(entry.sourceServiceId)).filter(Boolean))
  const sources = [item]
  for (const sourceId of new Set(entries.map(entry => id(entry.sourceTicketId)).filter(value => value && value !== item.id))) {
    const source = await store.ticket(q, sourceId)
    if (source) sources.push(source)
  }
  for (const source of sources) {
    if (source.origin === 'technical' && source.serviceIds?.length) contextIds.add(id(source.serviceIds[0]))
    if (source.legacyId?.startsWith('followup:')) contextIds.add(source.legacyId.slice('followup:'.length))
  }
  const linkedManually = entries.some(entry => entry.kind === 'event' && entry.action === 'Vinculó un servicio')
  item.resolutionServiceIds = linkedManually ? [...new Set((item.serviceIds || []).map(id).filter(value => value && !contextIds.has(value)))] : []
}

// Runs on the same database transaction as the agenda write. Notifications and
// the ticket relationship roll back together if any scheduling check fails.
async function synchronizeTicketServices({ q, pg, previous, next, user, now, reportRecordId, store }) {
  validateTicketEvidence(previous, next, { reportRecordId })
  const old = new Map((previous.history || []).map(record => [id(record.id), record]))
  const current = new Map((next.history || []).map(record => [id(record.id), record]))
  const changes = [...new Set([...old.keys(), ...current.keys()])].filter(key => !isDeepStrictEqual(old.get(key), current.get(key)))
  if (!changes.length) return
  const configuration = await store.settings(q), config = configuration.config
  const linked = new Set(changes.flatMap(key => [old.get(key)?.sourceTicketId, current.get(key)?.sourceTicketId].filter(Boolean).map(id)))
  // Indexed JSON membership keeps unrelated tickets out of this transaction.
  for (const key of changes) {
    const predicate = pg ? "(data::jsonb -> 'serviceIds') @> ?::jsonb" : "EXISTS (SELECT 1 FROM json_each(data,'$.serviceIds') WHERE value=?)"
    for (const row of await q('SELECT id FROM pignus_tickets WHERE '+predicate, [pg ? JSON.stringify([key]) : key])) linked.add(row.id)
  }
  // Resolve and lock every alias in a consistent order. A merge may leave the
  // historical number on a service; it still identifies the same principal.
  const reportedIds = current.get(id(reportRecordId))?.ticketResolution?.ticketIds || []
  const candidates = [...new Set([...linked, ...reportedIds.map(id)])].sort()
  const pathFor = async identifier => {
    const chain = [], seen = new Set()
    let item = await store.ticket(q, identifier)
    while (item) {
      if (seen.has(item.id)) d.fail('La referencia del ticket fusionado no es válida.', 409)
      seen.add(item.id); chain.push(item)
      if (item.status !== 'Fusionado') return chain
      if (!item.mergedIntoId) d.fail('La referencia del ticket fusionado no es válida.', 409)
      item = await store.ticket(q, item.mergedIntoId)
    }
    return []
  }
  const lockIds = new Set()
  for (const identifier of candidates) {
    const chain = await pathFor(identifier)
    if (!chain.length && linked.has(identifier)) d.fail('El ticket vinculado ya no existe. Actualizá antes de agendar.', 409)
    chain.forEach(item => lockIds.add(item.id))
  }
  if (pg && lockIds.size) await q('SELECT id FROM pignus_tickets WHERE id IN (' + [...lockIds].map(() => '?').join(',') + ') ORDER BY id FOR UPDATE', [...lockIds].sort())
  const groups = new Map()
  for (const identifier of candidates) {
    const chain = await pathFor(identifier)
    if (!chain.length) { if (linked.has(identifier)) d.fail('El ticket vinculado ya no existe. Actualizá antes de agendar.', 409); continue }
    if (chain.some(item => !lockIds.has(item.id))) d.fail('La referencia del ticket cambió durante la coordinación. Actualizá e intentá nuevamente.', 409)
    const principal = chain.at(-1)
    const group = groups.get(principal.id) || { item: principal, ids: new Set(), numbers: new Set() }
    chain.forEach(item => { group.ids.add(item.id); group.numbers.add(String(item.number)) })
    groups.set(principal.id, group)
  }
  for (const { item, ids: acceptedIds, numbers: acceptedNumbers } of [...groups.values()].sort((a,b)=>a.item.id.localeCompare(b.item.id))) {
    const beforeTicket = structuredClone(item)
    const newLinks = []
    const relevant = changes.filter(key => (item.serviceIds || []).includes(key) || acceptedIds.has(id(current.get(key)?.sourceTicketId)) || acceptedIds.has(id(old.get(key)?.sourceTicketId)))
    // Merely mentioning an unrelated ticket in a report grants no write access.
    if (!relevant.length) continue
    await adoptLegacyServiceLinks(q, item, store)
    for (const key of relevant) {
      const before = old.get(key), record = current.get(key)
      const isNewLink = record?.sourceTicketId && !(item.serviceIds || []).includes(key)
      if (isNewLink) {
        if (!user || !d.can(user, 'linkService')) d.fail('No tenés permiso para agendar desde este ticket.', 403)
        d.assertVisible(item, user, next, config)
        if (!d.OPEN_STATUSES.includes(item.status)) d.fail('El ticket ya se cerró. Reabrilo antes de agendar.', 409)
        if (!read.serviceWritable(record, user, next)) d.fail('No tenés permiso sobre el servicio.', 403)
        if (item.customerId && item.customerId !== id(read.customerForRecord(record, next)?.customerId || record.customerId)) d.fail('La cuenta del servicio no coincide con el ticket.')
        if (!acceptedNumbers.has(String(record.ticketNumber))) d.fail('La referencia visible del ticket cambió. Volvé a abrir la coordinación.', 409)
        item.serviceIds = [...new Set([...(item.serviceIds || []), key])]
        item.resolutionServiceIds = [...new Set([...(item.resolutionServiceIds || []), key])]
        newLinks.push(key)
      }
      if (record && item.customerId && item.customerId !== id(read.customerForRecord(record, next)?.customerId || record.customerId)) d.fail('El servicio vinculado debe conservar la cuenta del ticket.', 409)
      if (!d.OPEN_STATUSES.includes(item.status)) continue
      const wasScheduled = before && !canceled(before)
      const isScheduled = record && !canceled(record)
      const moved = wasScheduled && isScheduled && (before.date !== record.date || before.time !== record.time || id(before.teamId) !== id(record.teamId))
      const coordinated = isNewLink || (item.resolutionServiceIds || []).includes(key)
      const type = !coordinated ? null : isNewLink && isScheduled ? 'scheduled' : moved ? 'rescheduled' : wasScheduled && !isScheduled ? 'canceled' : null
      if (type) {
        if (type !== 'canceled') { item.status = 'En gestión'; item.nextReviewAt = ''; item.waitReason = '' }
        await store.communicate(q, item, type, `service:${key}:${type}:${item.version + 1}`, now, { service: schedule(record || before), date: (record || before).date, time: (record || before).time }, user)
      }
    }
    // A multi-day service is one obligation, including its intermediate visits.
    const required = (item.resolutionServiceIds || []).map(key => current.get(key)).filter(Boolean)
    const journeys = new Set(required.map(record => record.serviceJourney?.id).filter(Boolean))
    item.resolutionServiceIds = [...new Set([...(item.resolutionServiceIds || []), ...(next.history || []).filter(record => journeys.has(record.serviceJourney?.id)).map(record => id(record.id))])]
    item.serviceIds = [...new Set([...(item.serviceIds || []), ...item.resolutionServiceIds])]
    item.serviceSchedule = item.serviceIds.map(key => schedule(current.get(key))).filter(Boolean)
    const reported = current.get(id(reportRecordId))
    const hasNewEvidence = reported && relevant.includes(id(reportRecordId)) && reported.ticketResolution?.resolved === true && reported.ticketResolution.ticketIds?.some(value => acceptedIds.has(id(value))) && !isDeepStrictEqual(old.get(id(reportRecordId))?.ticketResolution, reported.ticketResolution)
    if (hasNewEvidence && d.OPEN_STATUSES.includes(item.status) && readyToResolve(item, next.history || [], [...acceptedIds])) {
      item.status = 'Resuelto'; item.resolvedAt = now; item.nextReviewAt = ''
      item.resolution = reported.technicalObservation
      item.resolutionMethod = 'onsite'
      item.resolvedByServiceId = id(reported.id)
      item.resolvedById = id(reported.ticketResolution.byId)
      item.resolvedByName = reported.ticketResolution.byName || 'Técnico'
      item.fulfilledFollowups = (next.history || []).filter(record => item.serviceIds.includes(id(record.id)) && record.followup && record.followup.relation !== 'different' && record.followup.createdAt < now).map(record => ({ id:record.followup.id, serviceId:id(record.id), resolvedByServiceId:id(reported.id), at:now }))
      await store.communicate(q, item, 'resolved', `service-resolution:${reported.id}:${reported.ticketResolution.at}`, now, { service: schedule(reported), sourceTechnical: true }, user)
    }
    if (!isDeepStrictEqual(item, beforeTicket)) {
      sla.transitionSla(item, beforeTicket, item.status === 'Resuelto' ? 'resolve' : 'scheduleService', config, now, { humanUpdate: item.origin !== 'email' && (newLinks.length > 0 || Boolean(reportRecordId && (item.resolutionServiceIds || []).includes(id(reportRecordId)))), actorId: user?.id })
      item.version++; item.updatedAt = now
      if (newLinks.length && user) item.participantIds = [...new Set([...(item.participantIds || []), id(user.id)])]
      await store.save(q, item)
    }
  }
}

module.exports = { synchronizeTicketServices, validateTicketEvidence, resolutionEvidence, readyToResolve, adoptLegacyServiceLinks }
