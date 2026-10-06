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
