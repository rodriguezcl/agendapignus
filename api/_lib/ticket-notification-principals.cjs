const { fail } = require('./tickets.cjs')

// Request-local batching: visibility and titles must always use fresh ticket data.
async function loadNotificationPrincipals(q, ids) {
  const roots = [...new Set(ids.map(String))]
  const key = id => String(id).replace(/^Ticket#/i, 'Ticket#')
  const tickets = new Map(), requested = new Set()
  let pending = [...new Set(roots.map(key))]
  while (pending.length) {
    const next = new Set()
    for (let offset = 0; offset < pending.length; offset += 50) {
      const batch = pending.slice(offset, offset + 50)
      batch.forEach(id => { requested.add(id); if (!tickets.has(id)) tickets.set(id, null) })
      const slots = batch.map(() => '?').join(',')
      const rows = await q(`SELECT data FROM pignus_tickets WHERE id IN (${slots}) OR number IN (${slots})`, [...batch, ...batch.map(id => id.replace(/^Ticket#/i, ''))])
      for (const row of rows) {
        const item = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        tickets.set(String(item.id), item)
        tickets.set(String(item.number), item)
        tickets.set(`Ticket#${item.number}`, item)
        if (item.status === 'Fusionado' && item.mergedIntoId) next.add(key(item.mergedIntoId))
      }
    }
    pending = [...next].filter(id => !requested.has(id) && !tickets.has(id))
  }
  return new Map(roots.map(id => {
    let item = tickets.get(key(id))
    const seen = new Set()
    while (item?.status === 'Fusionado') {
      if (!item.mergedIntoId || seen.has(item.id)) fail('La referencia del ticket fusionado no es válida.', 409)
      seen.add(item.id)
      item = tickets.get(key(item.mergedIntoId))
    }
    return [id, item || null]
  }))
}

module.exports = { loadNotificationPrincipals }
