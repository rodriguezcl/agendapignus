const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { frontendSources } = require('../scripts/lib/frontend-sources.cjs')
const { bindings, functionSource } = require('./helpers/frontend-source.cjs')

test('frontend source contracts inspect current declarations reachable from the application entry', () => {
  const sources = frontendSources()
  const root = path.resolve(__dirname, '..')
  for (const binding of bindings) {
    assert.ok(sources.has(path.join(root, binding.file)), `${binding.name} must belong to an active module`)
    assert.ok(functionSource(binding.name).length, `${binding.name} must exist in the current module`)
  }
})
