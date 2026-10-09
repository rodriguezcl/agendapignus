const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

function jsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? jsxFiles(file) : file.endsWith('.jsx') ? [file] : []
  })
}

test('every JSX button has an explicit descriptive title, including icon-only controls', () => {
  let count = 0
  for (const file of jsxFiles(path.join(__dirname, '../src'))) {
    const source = fs.readFileSync(file, 'utf8')
    traverse(parse(source, { sourceType: 'module', plugins: ['jsx'] }), {
      JSXOpeningElement({ node }) {
        if (node.name.name !== 'button') return
        count++
        const title = node.attributes.find(attribute => attribute.name?.name === 'title')
        assert.ok(title?.value, `${file}:${node.loc.start.line}: missing button description`)
        if (title.value.type === 'StringLiteral') assert.ok(title.value.value.length >= 30, `${file}:${node.loc.start.line}: description too short`)
      }
    })
  }
  assert.ok(count >= 269)
})

test('imperative buttons receive descriptions and sidebar does not replace them with labels', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  const creations = [...source.matchAll(/const (\w+) = (?:menuOpen \? )?document\.createElement\('button'\)/g)]
  // Photo buttons moved to the shared React attachment component.
  assert.ok(creations.length > 0, 'The imperative-button scan must not be empty')
  for (const match of creations) {
    const following = source.slice(match.index + match[0].length, match.index + match[0].length + 240)
    assert.ok(following.includes(`${match[1]}.title =`), `Missing description for ${match[1]} at ${match.index}`)
  }
  assert.doesNotMatch(source, /button\.title = button\.textContent\.trim\(\)/)
  for (const match of source.matchAll(/\.innerHTML = ([^\n]+)/g)) {
    for (const button of match[1].matchAll(/<button\b([^>]*)>/g)) assert.match(button[1], /title=/)
  }
})

test('confirmation explains technician visibility and retains disabled guidance', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  const confirmation = source.slice(source.indexOf('function ServiceConfirmationButton('), source.indexOf('function Confirm('))
  assert.match(confirmation, /queda oculto al técnico hasta confirmarlo/)
  assert.match(confirmation, /Confirmá el servicio para habilitarlo al técnico/)
  assert.match(confirmation, /Guardá los cambios del servicio antes de cambiar la confirmación/)
})
