const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')

for (const name of ['BufferedInput', 'BufferedTextarea']) {
  test(`${name}: typing stays local, blur commits the latest text once`, () => {
    const start = source.indexOf(`function ${name}(`)
    const end = source.indexOf('\n}', start) + 2
    const code = transformSync(source.slice(start, end), { loader: 'jsx' }).code
    const slots = [], timers = new Map(), commits = []
    let cursor = 0, nextTimer = 0
    const hooks = {
      useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], value => { slots[index] = value }] },
      useRef(value) { const index = cursor++; return slots[index] ||= { current: value } },
      useEffect(effect, dependencies) { const index = cursor++; const previous = slots[index]; if (!previous || dependencies.some((value, i) => value !== previous[i])) { slots[index] = dependencies; effect() } },
      React: { createElement: (type, props) => ({ type, props }) },
      window: { clearTimeout: id => timers.delete(id), setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer } }
    }
    const Component = vm.runInNewContext(code + `\n${name}`, hooks)
    const render = () => { cursor = 0; return Component({ value: '', onCommit: value => commits.push(value) }).props }
    render().onFocus()
    for (const text of ['C', 'CA', 'CAPACITACIÓN']) render().onChange({ target: { value: text } })
    assert.deepEqual(commits, [])
    assert.equal(render().value, 'CAPACITACIÓN')
    assert.equal(timers.size, 1)
    render().onBlur()
    assert.deepEqual(commits, ['CAPACITACIÓN'])
    assert.equal(timers.size, 0)
    render().onBlur()
    assert.equal(commits.length, 1)
  })
}

test('weekly manual fields use local buffering, including internal notes and amounts', () => {
  const start = source.lastIndexOf('return <div className="modal-backdrop weekly-editor-backdrop"')
  assert.ok(start >= 0, 'weekly service editor exists')
  const modal = source.slice(start, source.indexOf('\n  return ', start + 1))
  assert.match(modal, /BufferedInput[^>]+value=\{task.client\}/)
  assert.match(modal, /BufferedInput[^>]+value=\{task.address\}/)
  assert.match(modal, /BufferedInput[^>]+value=\{task.phone\}/)
  assert.match(modal, /BufferedInput[^>]+value=\{task.time\}/)
  assert.match(modal, /ServiceExtraFields[^>]+buffered onChange=\{updateTaskDraft\}/)
  assert.match(source, /BufferedInput maxLength=\{500\} value=\{item.text\}/)
})
