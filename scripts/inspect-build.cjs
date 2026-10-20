// Measures the actual initial dependency graph, including shared chunks.
// Run after `npm run build`; no server, credentials or operational data needed.
const fs = require('node:fs')
const path = require('node:path')
const { gzipSync } = require('node:zlib')

function inspectBuild(directory = path.resolve(__dirname, '../dist')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.vite/manifest.json'), 'utf8'))
  const entries = Object.keys(manifest).filter(key => manifest[key].isEntry)
  const visited = new Set(), initial = new Set()
  const visit = key => {
    if (visited.has(key)) return
    visited.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Missing build dependency: ${key}`)
    initial.add(chunk.file)
    for (const css of chunk.css || []) initial.add(css)
    for (const dependency of chunk.imports || []) visit(dependency)
  }
  entries.forEach(visit)
  const files = [...initial].sort().map(file => {
    const content = fs.readFileSync(path.join(directory, file))
    return { file, bytes: content.length, gzipBytes: gzipSync(content).length }
  })
  const total = extension => files.filter(file => file.file.endsWith(extension))
    .reduce((sum, file) => ({ bytes: sum.bytes + file.bytes, gzipBytes: sum.gzipBytes + file.gzipBytes }), { bytes: 0, gzipBytes: 0 })
  return {
    initialJavaScript: total('.js'),
    initialStyles: total('.css'),
    deferredEntries: Object.values(manifest).filter(chunk => chunk.isDynamicEntry && !initial.has(chunk.file)).length,
    files
  }
}

if (require.main === module) {
  try { console.log(JSON.stringify(inspectBuild(), null, 2)) }
  catch (error) { console.error(`Build inspection failed: ${error.message}. Run npm run build first.`); process.exitCode = 1 }
}

module.exports = { inspectBuild }
