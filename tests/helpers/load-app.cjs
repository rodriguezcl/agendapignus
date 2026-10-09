const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

// Bundle the real imports instead of evaluating incomplete source fragments.
module.exports = function loadApp(names) {
  const root = path.resolve(__dirname, '../..')
  const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const result = buildSync({ stdin: { contents: `${source}\nexport { ${names.join(', ')} };`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'test-app.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.id)
  return compiled.exports
}
