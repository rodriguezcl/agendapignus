const { database, readState } = require('../api/_lib/database.cjs')

function valueType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function inventory(values, maxDepth = 4) {
  const paths = new Map()
  const visit = (value, path, depth) => {
    if (value == null || depth > maxDepth) return
    if (Array.isArray(value)) {
      for (const item of value) {
        const itemPath = `${path}[]`
        const entry = paths.get(itemPath) || { count: 0, types: new Set() }
        entry.count += 1
        entry.types.add(valueType(item))
        paths.set(itemPath, entry)
        if (item && typeof item === 'object') visit(item, itemPath, depth + 1)
      }
      return
    }
    if (typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      const itemPath = path ? `${path}.${key}` : key
      const entry = paths.get(itemPath) || { count: 0, types: new Set() }
      entry.count += 1
      entry.types.add(valueType(item))
      paths.set(itemPath, entry)
      if (item && typeof item === 'object') visit(item, itemPath, depth + 1)
    }
  }
  for (const value of values) visit(value, '', 0)
  return Object.fromEntries([...paths].sort(([left], [right]) => left.localeCompare(right, 'en')).map(([path, entry]) => [path, { count: entry.count, types: [...entry.types].sort() }]))
}

async function main() {
  if (!process.argv.slice(2).every(argument => argument === '--production-read-only')) throw new Error('Este inventario solo admite --production-read-only.')
  const sql = database()
  try {
    const state = await sql.begin(async transaction => {
      await transaction`set transaction isolation level repeatable read, read only`
      await transaction`set local statement_timeout = '20000'`
      return readState(transaction)
    })
    console.log(JSON.stringify({
      revision: state.revision,
      collections: Object.fromEntries(['roles', 'employees', 'customers', 'services', 'vehicles', 'history', 'reviews'].map(name => [name, { records: state[name].length, fields: inventory(state[name]) }])),
      agendaConfigurationKeys: Object.keys(state.agenda?.weekly || {}).filter(key => key.startsWith('_')).sort(),
      agendaConfiguration: inventory(Object.entries(state.agenda?.weekly || {}).filter(([key]) => key.startsWith('_')).map(([, value]) => value)),
      productionModified: false
    }, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: 'No se completó el inventario. No se aplicaron cambios a producción.', code: error.code || 'INVENTORY_FAILED' }))
  process.exitCode = 1
})

module.exports = { inventory }
