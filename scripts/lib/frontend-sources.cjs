const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

// Inspect the code reachable from the real entry, including deferred screens.
// A source check must not pass merely because a superseded file still exists.
function frontendSources(entry = path.resolve(__dirname, '../../src/main.jsx')) {
  const sources = new Map()
  function visit(file) {
    if (sources.has(file)) return
    const source = fs.readFileSync(file, 'utf8')
    sources.set(file, source)
    const dependencies = []
    const add = value => {
      if (typeof value !== 'string' || !value.startsWith('.')) return
      const dependency = path.resolve(path.dirname(file), value)
      if (/\.(jsx?|mjs)$/.test(dependency)) dependencies.push(dependency)
    }
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
    traverse(ast, {
      ImportDeclaration({ node }) { add(node.source.value) },
      ExportNamedDeclaration({ node }) { add(node.source?.value) },
      ExportAllDeclaration({ node }) { add(node.source.value) },
      CallExpression({ node }) {
        if (node.callee.type === 'Import') add(node.arguments[0]?.value)
      }
    })
    dependencies.forEach(visit)
  }
  visit(entry)
  return sources
}

module.exports = { frontendSources }
