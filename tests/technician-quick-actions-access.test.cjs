const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')

test('locked service cards do not render directions, phone or start actions', () => {
  assert.match(source, /const serviceUnlocked = !card.classList.contains\('locked'\)/)
  assert.match(source, /if \(serviceUnlocked && serviceRecord.address\)/)
  assert.match(source, /if \(serviceUnlocked && serviceRecord.phone\)/)
  assert.match(source, /if \(serviceUnlocked\) quickActions.prepend\(start\)/)
  assert.match(source, /quickActions.append\(detailToggle\)/)
})
