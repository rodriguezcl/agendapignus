// Keep one color per author and avoid palette collisions within a conversation.
export function ticketAuthorColors(entries = []) {
  const palette = [210, 145, 275, 32, 185, 335, 65, 245]
  const assigned = new Map()
  return entries.map(entry => {
    const key = String(entry.byId || entry.from || entry.byName || entry.authorName || entry.createdByName || 'Sistema').trim().toLocaleLowerCase('es-AR')
    if (!assigned.has(key)) {
      let hash = 0
      for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
      let index = hash % palette.length
      if (assigned.size < palette.length) {
        const used = new Set(assigned.values())
        while (used.has(palette[index])) index = (index + 1) % palette.length
      }
      assigned.set(key, palette[index])
    }
    return { '--ticket-author-hue': assigned.get(key) }
  })
}
