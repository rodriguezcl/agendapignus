const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

test('el dominio permanece independiente de React y de infraestructura', () => {
  const domain = path.join(root, 'src/domain')
  const files = fs.readdirSync(domain, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.mjs'))
  assert.ok(files.length >= 10)
  for (const entry of files) {
    const source = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')
    assert.doesNotMatch(source, /from ['"]react['"]|from ['"].*infrastructure\//, entry.name)
  }
})

test('el catálogo construye servicios sin depender de la interfaz', async () => {
  const { buildServiceRecord, serviceIsReferenced } = await import('../src/domain/services/service-catalog.mjs')
  const record = buildServiceRecord({ name: 'Instalación especial', description: '', estimatedMinutes: 45, status: 'Activo' }, null, () => 77)
  assert.deepEqual(record, {
    name: 'Instalación especial', description: '', estimatedMinutes: 45, status: 'Activo',
    id: 77, code: 'service-77', category: 'installation'
  })
  assert.equal(serviceIsReferenced(77, [{ serviceId: 77 }]), true)
  assert.equal(serviceIsReferenced(77, [], [{ tasks: [{ serviceId: 77 }] }]), true)
  assert.equal(serviceIsReferenced(77, [], [], {}), false)
})

test('el catálogo rechaza duraciones fuera de la regla de negocio', async () => {
  const { buildServiceRecord } = await import('../src/domain/services/service-catalog.mjs')
  assert.throws(() => buildServiceRecord({ name: 'Inválido', estimatedMinutes: 10 }, null), /entre 15 minutos y 12 horas/)
})
