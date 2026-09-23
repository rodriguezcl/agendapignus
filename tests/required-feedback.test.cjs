const test = require('node:test')
const assert = require('node:assert/strict')
const load = () => import('../src/presentation/components/forms/required-feedback.mjs')
const field = (patch = {}) => ({ type: 'text', value: '', required: true, disabled: false, getAttribute: () => null, closest: () => null, ...patch })
const scope = items => ({ querySelectorAll: () => items })

test('all empty mandatory controls are identified, including whitespace', async () => {
  const { requiredControlMissing } = await load()
  const fields = [field(), field({ value: '  ' }), field({ value: 'Completo' }), field({ value: 0 })]
  assert.deepEqual(fields.map(item => requiredControlMissing(item, scope(fields))), [true, true, false, false])
  fields[0].value = 'Nombre'
  assert.equal(requiredControlMissing(fields[0], scope(fields)), false)
})
test('optional, disabled and hidden controls are excluded', async () => {
  const { requiredControlMissing } = await load()
  for (const item of [field({ required: false }), field({ disabled: true }), field({ type: 'hidden' }), field({ getAttribute: name => name === 'aria-required' ? 'false' : null })]) assert.equal(requiredControlMissing(item, scope([])), false)
})
test('ARIA and visible required labels cover custom forms', async () => {
  const { requiredControlMissing } = await load()
  assert.equal(requiredControlMissing(field({ required: false, getAttribute: name => name === 'aria-required' ? 'true' : null }), scope([])), true)
  assert.equal(requiredControlMissing(field({ required: false, closest: () => ({ querySelector: () => ({}) }) }), scope([])), true)
})
test('radio requirements apply to the whole group and uploads use files', async () => {
  const { requiredControlMissing } = await load()
  const a = field({ type: 'radio', name: 'zone', checked: false })
  const b = field({ type: 'radio', name: 'zone', checked: false })
  assert.equal(requiredControlMissing(a, scope([a, b])), true)
  b.checked = true
  assert.equal(requiredControlMissing(a, scope([a, b])), false)
  assert.equal(requiredControlMissing(field({ type: 'file', files: [] }), scope([])), true)
  assert.equal(requiredControlMissing(field({ type: 'file', files: [{}] }), scope([])), false)
})
test('an available daily slot has no missing required fields until service data is entered', async () => {
  const { dailyTaskRowHasContent, requiredControlMissing } = await load()
  const values = [{ value: '' }, { value: '  ' }]
  const row = { matches: selector => selector === '.task-row', querySelectorAll: () => values }
  const control = field({ closest: selector => selector === '.task-row' ? row : null })

  assert.equal(dailyTaskRowHasContent(row), false)
  assert.equal(requiredControlMissing(control, scope([control])), false)
  values[0].value = 'Servicio de alarma'
  assert.equal(dailyTaskRowHasContent(row), true)
  assert.equal(requiredControlMissing(control, scope([control])), true)
})
