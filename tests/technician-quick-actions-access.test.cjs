const { frontendSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const source = frontendSource()

test('locked service cards do not render directions, phone or start actions', () => {
  assert.match(source, /const serviceUnlocked = !card.classList.contains\('locked'\)/)
  assert.match(source, /if \(can\('records.contact'\) && serviceUnlocked && destination\?\.url\)/)
  assert.match(source, /if \(can\('records.contact'\) && serviceUnlocked && serviceRecord.phone\)/)
  assert.match(source, /if \(serviceUnlocked && can\('technical.start'\) && canWriteRecord\(serviceRecord, permissionSubject\)\) quickActions.prepend\(start\)/)
  assert.match(source, /quickActions.append\(detailToggle\)/)
})
