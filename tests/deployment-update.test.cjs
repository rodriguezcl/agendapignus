const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/components/DeploymentUpdate.jsx'), 'utf8')

function scenario({ busy = false, guard = null, edited = false, modal = false } = {}) {
  let reloads = 0, error = ''
  const start = source.indexOf('  const proceed = () =>')
  const code = source.slice(start, source.indexOf('  const proceedRef', start))
  const proceed = vm.runInNewContext(code + '\nproceed', {
    latest: { current: { busy, guard: { current: guard } } }, running: { current: false },
    edited: { current: new Set(edited ? [{ isConnected: true }] : []) },
    document: { querySelectorAll: () => modal ? [{ matches: () => false, querySelector: () => ({}) }] : [], querySelector: () => null },
    reload: () => { reloads++ }, setError: message => { error = message }
  })
  proceed()
  return { reloads, error }
}
test('clean sessions can update, but saving sessions wait', () => {
  assert.equal(scenario().reloads, 1)
  assert.equal(scenario({ busy: true }).reloads, 0)
})
test('agenda guard controls the continuation; no premature reload', () => {
  let next
  const result = scenario({ guard: action => { next = action } })
  assert.equal(result.reloads, 0)
  assert.equal(typeof next, 'function')
})
test('other edited forms and open editors prevent a reload', () => {
  for (const options of [{ edited: true }, { modal: true }]) {
    const result = scenario(options)
    assert.equal(result.reloads, 0)
    assert.ok(result.error)
  }
})
test('manifest is uncached and failed checks never log users out', () => {
  assert.match(source, /cache: 'no-store'/)
  assert.match(source, /setInterval\(check, 60000\)/)
  assert.match(source, /requireServerLogout: true/)
  const config = JSON.parse(fs.readFileSync(require.resolve('../vercel.json'), 'utf8'))
  assert.ok(config.headers.find(rule => rule.source === '/version.json').headers.some(header => header.value.includes('no-store')))
})
