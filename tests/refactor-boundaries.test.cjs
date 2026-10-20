const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

const root = path.resolve(__dirname, '../src')
function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sources(file) : /\.(jsx?|mjs)$/.test(file) ? [file] : []
  })
}

test('production modules contain no executable statements after an unconditional return', () => {
  const violations = []
  for (const file of sources(root)) {
    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
    traverse(ast, {
      BlockStatement({ node }) {
        const end = node.body.findIndex(statement => statement.type === 'ReturnStatement' || statement.type === 'ThrowStatement')
        if (end < 0) return
        // Function declarations are hoisted and can legitimately follow a return.
        const unreachable = node.body.slice(end + 1).find(statement => !['FunctionDeclaration', 'EmptyStatement'].includes(statement.type))
        if (unreachable) violations.push(`${path.relative(root, file)}:${unreachable.loc.start.line}`)
      }
    })
  }
  assert.deepEqual(violations, [], 'Remove superseded implementations instead of retaining unreachable copies')
})

test('extracted features do not depend on the application composition root', () => {
  const violations = []
  for (const file of sources(path.join(root, 'features'))) {
    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
    traverse(ast, {
      ImportDeclaration({ node }) {
        if (/\/App(?:\.jsx?)?$/.test(node.source.value)) violations.push(path.relative(root, file))
      }
    })
  }
  assert.deepEqual(violations, [], 'Shared dependencies belong in independent modules, never in App.jsx')
})
