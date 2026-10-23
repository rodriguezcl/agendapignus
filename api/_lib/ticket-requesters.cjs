function uniqueIds(values) {
  return [...new Set(values.filter(value => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)).map(value => String(value).trim()).filter(Boolean))]
}

function requesterIds(ticket) {
  return uniqueIds([ticket?.createdById, ticket?.requesterId, ...(Array.isArray(ticket?.mergedRequesterIds) ? ticket.mergedRequesterIds : []), ...(Array.isArray(ticket?.coRequesterIds) ? ticket.coRequesterIds : [])])
}

function mergeRequesterIds(target, source) {
  return uniqueIds([...requesterIds(target), ...requesterIds(source)])
}

function sourceTicketIds(ticket) {
  return uniqueIds([ticket?.id, ...(Array.isArray(ticket?.mergedTicketIds) ? ticket.mergedTicketIds : [])])
}

// El llamador debe ejecutar esta reconstrucción dentro de una transacción.
async function backfillMergedRequesters(q, { pg = false } = {}) {
  if (!(await q('SELECT id FROM pignus_tickets WHERE status=? LIMIT 1', ['Fusionado'])).length) return { updated: 0 }

  // Leemos después de bloquear: una fusión o gestión concurrente no puede cambiar
  // la cadena ni perder datos al guardar sus solicitantes e identificadores.
  const rows = await q(`SELECT id,status,data FROM pignus_tickets ORDER BY id${pg ? ' FOR UPDATE' : ''}`)
  const byId = new Map(rows.map(row => [String(row.id), { ...row, ticket: JSON.parse(row.data) }]))
  const terminals = new Map()
  function terminalFor(id) {
    const path = [], seen = new Set()
    let current = String(id), terminal = null
    while (!seen.has(current)) {
      if (terminals.has(current)) { terminal = terminals.get(current); break }
      const row = byId.get(current)
      if (!row) break
      path.push(current)
      seen.add(current)
      if (row.status !== 'Fusionado') { terminal = current; break }
      if (!row.ticket.mergedIntoId) break
      current = String(row.ticket.mergedIntoId)
    }
    for (const entry of path) terminals.set(entry, terminal)
    return terminal
  }

  const originalsByTarget = new Map()
  for (const row of rows) {
    if (row.status !== 'Fusionado') continue
    const targetId = terminalFor(row.id)
    if (!targetId) continue // Las cadenas rotas o circulares nunca otorgan acceso.
    const source = byId.get(String(row.id)).ticket
    const originals = originalsByTarget.get(targetId) || { requesters: [], tickets: [] }
    originals.requesters.push(...uniqueIds([source.createdById, source.requesterId]))
    originals.tickets.push(String(row.id))
    originalsByTarget.set(targetId, originals)
  }

  let updated = 0
  for (const [targetId, originals] of originalsByTarget) {
    const target = byId.get(targetId).ticket
    const mergedRequesterIds = uniqueIds([...requesterIds(target), ...originals.requesters])
    const mergedTicketIds = uniqueIds([...sourceTicketIds(target), ...originals.tickets])
    if (JSON.stringify(target.mergedRequesterIds) === JSON.stringify(mergedRequesterIds) && JSON.stringify(target.mergedTicketIds) === JSON.stringify(mergedTicketIds)) continue
    await q('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify({ ...target, mergedRequesterIds, mergedTicketIds }), targetId])
    updated++
  }
  return { updated }
}

module.exports = { requesterIds, mergeRequesterIds, sourceTicketIds, backfillMergedRequesters }
