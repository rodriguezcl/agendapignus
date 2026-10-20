const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const { bindings } = require('./frontend-source.cjs')

const components = {
  AttachmentDraftField: ['src/components/Attachments.jsx', 'AttachmentDraftField'],
  TechnicianReportModal: ['src/components/TechnicianReportModal.jsx', 'default'],
  ServicePreparationButton: ['src/components/ServicePreparationButton.jsx', 'default'],
  ServiceJourneys: ['src/components/ServiceJourneys.jsx', 'ServiceJourneys'],
  ServiceJourneysContext: ['src/components/ServiceJourneys.jsx', 'ServiceJourneysContext'],
  JourneyHistory: ['src/components/ServiceJourneys.jsx', 'JourneyHistory']
}

// Load the same modules used by the application. In particular, do not render
// the root's lazy wrappers or execute a concatenation of inspected source text.
module.exports = function loadApp(names) {
  const root = path.resolve(__dirname, '../..')
  const source = names.map(name => {
    const binding = bindings.find(entry => entry.name === name)
    const [file, exported] = components[name] || [binding?.file, name]
    if (!file || file === 'src/App.jsx') throw new Error(`No extracted frontend module for ${name}`)
    return `export { ${exported} as ${name} } from ${JSON.stringify(`./${file}`)}`
  }).join('\n')
  const result = buildSync({ stdin: { contents: source, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'test-app.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.id)
  return compiled.exports
}
