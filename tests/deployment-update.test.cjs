const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/components/DeploymentUpdate.jsx'), 'utf8')

function scenario({ active = true, busy = false, running = false, guard = null, edited = false, modal = false } = {}) {
  let reloads = 0, error = ''
  const start = source.indexOf('  const proceed = () =>')
  const code = source.slice(start, source.indexOf('  const proceedRef', start))
  const proceed = vm.runInNewContext(code + '\nproceed', {
    latest: { current: { active, busy, guard: { current: guard } } }, running: { current: running },
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

test('signed-out users can update despite login edits, modals or a stale agenda guard', () => {
  const result = scenario({ active: false, edited: true, modal: true, guard: () => { throw new Error('Stale guard must not run') } })
  assert.equal(result.reloads, 1)
  assert.equal(result.error, '')
})

test('signed-out updates still wait for in-flight work and prevent duplicate reloads', () => {
  assert.equal(scenario({ active: false, busy: true }).reloads, 0)
  assert.equal(scenario({ active: false, running: true }).reloads, 0)
})

test('reload after session expiry does not call logout again', async () => {
  let reloads = 0, logouts = 0
  const start = source.indexOf('  const reload = async () =>')
  const code = source.slice(start, source.indexOf('  const proceed =', start))
  const reload = vm.runInNewContext(code + '\nreload', {
    latest: { current: { active: false, busy: false, logout: () => { logouts++ } } },
    running: { current: false }, setError: () => {},
    window: { location: { reload: () => { reloads++ } } }
  })
  await reload()
  await reload()
  assert.equal(reloads, 1)
  assert.equal(logouts, 0)
})
test('manifest is uncached and failed checks never log users out', () => {
  assert.match(source, /cache: 'no-store'/)
  assert.match(source, /setInterval\(check, 60000\)/)
  assert.match(source, /requireServerLogout: true/)
  const config = JSON.parse(fs.readFileSync(require.resolve('../vercel.json'), 'utf8'))
  assert.ok(config.headers.find(rule => rule.source === '/version.json').headers.some(header => header.value.includes('no-store')))
})
