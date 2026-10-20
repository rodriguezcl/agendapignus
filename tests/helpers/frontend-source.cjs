const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')
const bindings = require('./frontend-bindings.json')
const root = path.resolve(__dirname, '../..')
const files = new Map()

function fileDeclarations(file) {
  if (files.has(file)) return files.get(file)
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const declarations = new Map(), imports = []
  for (const statement of ast.program.body) {
    const node = statement.declaration || statement
    if (node.type === 'ImportDeclaration') imports.push(source.slice(node.start, node.end))
    const names = node.id ? [node.id.name] : (node.declarations || []).flatMap(declaration => declaration.id.type === 'Identifier' ? [declaration.id.name] : [])
    const start = statement.type === 'ExportDefaultDeclaration' ? statement.start : node.start
    for (const name of names) declarations.set(name, source.slice(start, node.end))
  }
  const result = { declarations, imports }
  files.set(file, result)
  return result
}

function functionSource(name) {
  const binding = bindings.find(entry => entry.name === name)
  if (!binding) throw new Error(`Unknown frontend binding: ${name}`)
  const declaration = fileDeclarations(binding.file).declarations.get(name)
  if (!declaration) throw new Error(`Missing live frontend binding ${name} in ${binding.file}`)
  return declaration
}

// Existing source contracts can span neighboring components. Read their actual
// declarations in the extraction order; never keep an old copy of application
// code or use this inspection string as an executable bundle.
function frontendSource() {
  const declarations = bindings.slice().sort((left, right) => left.order - right.order).map(binding => functionSource(binding.name))
  const imports = [...new Set(bindings.map(binding => binding.file))].flatMap(file => fileDeclarations(file).imports)
  return [...new Set(imports), ...new Set(declarations)].join('\n\n')
}

module.exports = { frontendSource, functionSource, bindings }
