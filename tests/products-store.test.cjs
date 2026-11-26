const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { productRequest } = require('../api/_lib/product-http.cjs')
const { baseProducts } = require('../shared/product-catalog.cjs')

const admin = { id: 'admin', roleCode: 'administrator' }
const tech = { id: 'tech', roleCode: 'technician' }
const supervisor = { id: 'supervisor', roleCode: 'supervisor' }
const other = { id: 'user', roleCode: 'user' }
const newId = () => 'custom:' + randomUUID()
const png = { mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL+lrkAAAAASUVORK5CYII=' }
const editable = { category: 'alarm', kind: 'sensor', brand: 'Marca local', model: 'S-10', description: '', source: '', active: true }

async function setup(engine) {
  let connection, close
  if (engine === 'sqlite') {
    connection = new DatabaseSync(':memory:')
    close = () => connection.close()
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const pg = await PGlite.create()
    connection = pgliteAdapter(pg)
    connection.begin = callback => pg.transaction(tx => callback(pgliteAdapter(tx)))
    close = () => pg.close()
  }
  const request = (user, method, route, options) => productRequest({ user, method, route, connection, kind: engine === 'sqlite' ? 'db' : 'sql', ...options })
  return { close, list: user => request(user, 'GET', '/products').then(result => result.body),
    update: (input, user = admin) => request(user, 'POST', '/products', { input }).then(result => result.body.product),
    photo: (id, user = admin) => request(user, 'GET', '/products/photo', { query: { id } }).then(result => result.file) }
}

for (const engine of ['sqlite', 'postgres']) {
  test('Productos ' + engine + ': alta con foto, edición, baja y recuperación del catálogo', async t => {
    const api = await setup(engine)
    t.after(api.close)
    assert.deepEqual(await api.list(admin), { overrides: [], canManage: true })
    assert.equal((await api.list(supervisor)).canManage, false)
    assert.equal((await api.list(tech)).canManage, false)
    await assert.rejects(api.list(other), { statusCode: 403 })
    await assert.rejects(api.list({ ...admin, status: 'Inactivo' }), { statusCode: 403 })

    const id = newId()
    const create = { id, expectedVersion: 0, product: editable, photo: png }
    await assert.rejects(api.update(create, supervisor), { statusCode: 403 })
    await assert.rejects(api.update(create, tech), { statusCode: 403 })
    await assert.rejects(api.update({ ...create, photo: undefined }), { statusCode: 400 })
    await assert.rejects(api.update({ ...create, photo: { ...png, mimeType: 'image/jpeg' } }), { statusCode: 400 })
    await assert.rejects(api.update({ ...create, photo: { mimeType: 'image/png', contentBase64: 'A'.repeat(4 * 1024 * 1024 + 4) } }), { statusCode: 400 })
    await assert.rejects(api.update({ ...create, product: { ...editable, source: 'javascript:alert(1)' } }), { statusCode: 400 })
    await assert.rejects(api.update({ ...create, product: { ...editable, kind: 'ip_camera' } }), { statusCode: 400 })
    const concurrent = await Promise.allSettled([api.update(create), api.update({ ...create, id: newId() })])
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal(concurrent.find(item => item.status === 'rejected').reason.code, 'PRODUCT_DUPLICATE')
    const saved = concurrent.find(item => item.status === 'fulfilled').value
    assert.equal(saved.version, 1)
    assert.match(saved.image, /^\/api\/products\/photo\?id=/)
    assert.deepEqual(await api.update({ ...create, id: saved.id }), saved)
    assert.deepEqual((await api.photo(saved.id, tech)).data, Buffer.from(png.contentBase64, 'base64'))
    await assert.rejects(api.photo(saved.id, other), { statusCode: 403 })

    const archive = { id: saved.id, expectedVersion: 1, product: { ...editable, active: false } }
    const archived = await api.update(archive)
    assert.equal(archived.image, saved.image)
    assert.equal(archived.version, 2)
    await assert.rejects(api.update({ ...archive, product: { ...editable, description: 'otra sesión' } }), { code: 'PRODUCT_VERSION_CONFLICT' })
    await assert.rejects(api.update({ ...create, id: newId(), product: { ...editable, brand: editable.brand.toLowerCase() } }), { code: 'PRODUCT_DUPLICATE' })
    assert.deepEqual((await api.list(tech)).overrides, [archived])
    const reactivate = await api.update({ id: saved.id, expectedVersion: 2, product: { ...editable, model: 'S-11' } })
    assert.equal(reactivate.active, true)
    assert.equal(reactivate.model, 'S-11')

    const base = baseProducts.find(product => product.brand === 'Dahua')
    await assert.rejects(api.update({ ...create, id: newId(), product: base }), { code: 'PRODUCT_DUPLICATE' })
    const replacement = await api.update({ id: base.id, expectedVersion: 0, product: base, photo: png })
    assert.notEqual(replacement.image, base.image)
    assert.equal(replacement.caption, '')
    assert.deepEqual((await api.photo(base.id)).data, Buffer.from(png.contentBase64, 'base64'))
    const unnamed = baseProducts.find(product => !product.brand)
    const archivedBase = await api.update({ id: unnamed.id, expectedVersion: 0, product: { ...unnamed, active: false } })
    assert.equal(archivedBase.image, unnamed.image)
    assert.equal(archivedBase.active, false)
    assert.equal((await api.update({ id: unnamed.id, expectedVersion: 1, product: unnamed })).active, true)
  })
}
