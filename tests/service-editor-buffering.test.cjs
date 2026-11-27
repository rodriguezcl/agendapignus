const { frontendSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const source = frontendSource()

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

test('Enter publica el último valor de hora, contacto e importe antes de guardar el servicio', async () => {
  const fields = fs.readFileSync(require.resolve('../src/features/agenda/presentation/AgendaFields.jsx'), 'utf8')
  const functions = ['BufferedInput', 'CurrencyInput', 'commitBeforeEnter'].map(name => {
    const start = fields.indexOf(`function ${name}(`)
    return fields.slice(start, fields.indexOf('\n}', start) + 2)
  })
  const code = transformSync(functions.join('\n'), { loader: 'jsx' }).code
  const { normalizeCurrencyAmount, formatCurrencyAmount } = await import('../src/features/services/application/service-fields.mjs')
  let synchronous = false
  const components = vm.runInNewContext(code + '\n;({ BufferedInput, CurrencyInput })', {
    React: { createElement: (type, props) => ({ props }) },
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {},
    window: { setTimeout() {}, clearTimeout() {} },
    normalizeCurrencyAmount, formatCurrencyAmount,
    flushSync(commit) { synchronous = true; commit(); synchronous = false }
  })
  for (const [field, original, typed, expected] of [
    ['BufferedInput', '14:45', '15:45', '15:45'],
    ['BufferedInput', '111', '222', '222'],
    ['CurrencyInput', '100', '45,25', '45.25']
  ]) {
    const commits = []
    const { props } = components[field]({ value: original, buffered: true, onCommit: value => commits.push([value, synchronous]) })
    props.onChange({ target: { value: typed } })
    const event = { key: 'Enter', currentTarget: { value: typed }, nativeEvent: {} }
    props.onKeyDown({ ...event, nativeEvent: { isComposing: true } })
    props.onKeyDown({ ...event, defaultPrevented: true })
    assert.deepEqual(commits, [])
    props.onKeyDown(event)
    props.onKeyDown(event)
    assert.deepEqual(commits, [[expected, true]])
  }
})

test('weekly manual fields use local buffering, including internal notes and amounts', () => {
  const start = source.lastIndexOf('return <div className="modal-backdrop weekly-editor-backdrop"')
  assert.ok(start >= 0, 'weekly service editor exists')
  const modal = source.slice(start, source.indexOf('\n  return ', start + 1))
  assert.match(modal, /BufferedInput[^>]+value=\{task.client\}/)
  assert.match(modal, /BufferedInput[^>]+value=\{task.address\}/)
  assert.match(modal, /BufferedInput[^>]+value=\{task.phone\}/)
  assert.match(modal, /BufferedInput[^>]+value=\{task.time\}/)
  assert.match(modal, /ServiceExtraFields[^>]+buffered onChange=\{updateTaskDraft\}/)
  assert.match(source, /BufferedInput[^>]+maxLength=\{500\} value=\{item.text\}/)
})
