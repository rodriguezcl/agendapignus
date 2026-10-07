const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../src/components/ServiceTypesField.jsx'), 'utf8')

test('el nombre y la casilla comparten una asociación explícita y única por selector', () => {
  assert.ok(source.includes('const id = useId()'))
  assert.ok(source.includes('htmlFor={`${id}-service-${service.id}`}'))
  assert.ok(source.includes('id={`${id}-service-${service.id}`} type="checkbox"'))
  assert.ok(source.includes('disabled={disabled}'))
})

test('el desplegable no desmonta las etiquetas durante el blur previo al clic nativo', () => {
  assert.ok(!source.includes('onBlur='))
  for (const event of ['pointerdown', 'focusin']) {
    assert.ok(source.includes(`addEventListener('${event}', closeOutside)`))
    assert.ok(source.includes(`removeEventListener('${event}', closeOutside)`))
  }
  assert.ok(source.includes("event.key === 'Escape'"))
})

test('el foco transitorio del modal no cierra el selector, pero clic y foco externos sí', async () => {
  const { shouldDismissSelector } = await import('../src/components/selector-dismiss.mjs')
  const checkbox = { contains: () => false }
  const label = { contains: node => node === checkbox }
  const root = { contains: node => [root, label, checkbox].includes(node) }
  const dialog = { contains: node => node === root }
  const outside = { contains: () => false }
  assert.ok(source.includes('shouldDismissSelector(root.current, event.target, event.type)'))
  for (const target of [label, checkbox]) {
    assert.equal(shouldDismissSelector(root, target, 'pointerdown'), false)
    assert.equal(shouldDismissSelector(root, target, 'focusin'), false)
  }
  assert.equal(shouldDismissSelector(root, dialog, 'focusin'), false)
  assert.equal(shouldDismissSelector(root, dialog, 'pointerdown'), true)
  assert.equal(shouldDismissSelector(root, outside, 'focusin'), true)
  assert.equal(shouldDismissSelector(root, outside, 'pointerdown'), true)
  assert.equal(shouldDismissSelector(null, outside, 'focusin'), false)
})
