const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { productRequest } = require('../api/_lib/product-http.cjs')
const { baseProducts } = require('../shared/product-catalog.cjs')
const { postgresProductOverrides, sqliteProductOverrides } = require('../api/_lib/product-store.cjs')
const { prepareServiceMaterials } = require('../api/_lib/service-materials.cjs')

const admin = { id: 'admin', roleCode: 'administrator' }
const tech = { id: 'tech', roleCode: 'technician' }
const supervisor = { id: 'supervisor', roleCode: 'supervisor' }
const other = { id: 'user', roleCode: 'user' }
const planner = { id: 'planner', roleCode: 'coordinator', permissions: { weekly: true } }
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
  return { close, serviceOverrides: () => engine === 'sqlite' ? sqliteProductOverrides(connection) : postgresProductOverrides(connection),
    list: user => request(user, 'GET', '/products').then(result => result.body),
    update: (input, user = admin) => request(user, 'POST', '/products', { input }).then(result => result.body.product),
    setActive: (items, active, user = admin) => request(user, 'POST', '/products', { input: { action: 'setActive', items, active } }).then(result => result.body.products),
    photo: (id, user = admin) => request(user, 'GET', '/products/photo', { query: { id } }).then(result => result.file) }
}

for (const engine of ['sqlite', 'postgres']) {
  test('Productos ' + engine + ': alta con foto, edición, baja y recuperación del catálogo', async t => {
    const api = await setup(engine)
    t.after(api.close)
    assert.deepEqual(await api.serviceOverrides(), [])
    assert.deepEqual(await api.list(admin), { overrides: [], canManage: true })
    assert.equal((await api.list(supervisor)).canManage, false)
    assert.equal((await api.list(tech)).canManage, false)
    await assert.rejects(api.list(other), { statusCode: 403 })
    await assert.rejects(api.list({ ...admin, status: 'Inactivo' }), { statusCode: 403 })

    const id = newId()
    const create = { id, expectedVersion: 0, product: editable, photo: png }
    assert.equal((await api.list(planner)).canManage, false)
    await assert.rejects(api.update(create, planner), { statusCode: 403 })
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
    assert.deepEqual(await api.serviceOverrides(), [saved])
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

  test('Productos ' + engine + ': baja y reactivación en bloque con versiones, fotos y entregas anteriores', async t => {
    const api = await setup(engine)
    t.after(api.close)
    const custom = await api.update({ id: newId(), expectedVersion: 0, product: editable, photo: png })
    const selection = [custom, ...baseProducts.slice(0, 201)]
    const references = products => products.map(({ id, version }) => ({ id, expectedVersion: version }))
    const items = references(selection)
    const delivery = { history: [{ id: 'servicio', materials: [{ productId: custom.id, quantity: 1 }] }] }
    const savedDelivery = prepareServiceMaterials(delivery, {}).apply(await api.serviceOverrides())
    for (const user of [tech, planner, supervisor, { ...admin, status: 'Inactivo' }]) {
      await assert.rejects(api.setActive(items, false, user), { statusCode: 403 })
    }
    await assert.rejects(api.setActive([], false), { statusCode: 400 })
    await assert.rejects(api.setActive(items, 'false'), { statusCode: 400 })
    await assert.rejects(api.setActive([items[0], items[0]], false), { statusCode: 400 })
    await assert.rejects(api.setActive([items[0], { id: items[1].id }], false), { statusCode: 400 })
    await assert.rejects(api.setActive([...items, { id: newId(), expectedVersion: 0 }], false), { statusCode: 404 })
    await assert.rejects(api.setActive([...items.slice(0, -1), { ...items.at(-1), expectedVersion: 3 }], false), { code: 'PRODUCT_VERSION_CONFLICT' })
    assert.deepEqual(await api.serviceOverrides(), [custom])

    const archived = await api.setActive(items, false)
    assert.deepEqual(archived, selection.map(product => ({ ...product, active: false, version: product.version + 1 })))
    assert.deepEqual(await api.setActive(items, false), archived, 'Un reintento conserva las versiones ya confirmadas')
    assert.deepEqual(await api.setActive(references(archived), false), archived)
    assert.deepEqual((await api.photo(custom.id, tech)).data, Buffer.from(png.contentBase64, 'base64'))
    const inactive = await api.serviceOverrides()
    assert.equal(inactive.length, archived.length)
    assert.ok(inactive.every(product => !product.active))
    assert.deepEqual(prepareServiceMaterials(savedDelivery, savedDelivery).apply(inactive), savedDelivery)
    assert.throws(() => prepareServiceMaterials(delivery, {}).apply(inactive), { code: 'SERVICE_MATERIAL_INVALID' })

    const restored = await api.setActive(references(archived), true)
    assert.deepEqual(restored, selection.map(product => ({ ...product, version: product.version + 2 })))
    assert.deepEqual(prepareServiceMaterials(delivery, {}).apply(await api.serviceOverrides()), savedDelivery)
  })

  test('Productos ' + engine + ': cambiar un grupo mientras otra persona edita un producto conserva un solo resultado completo', async t => {
    const api = await setup(engine)
    t.after(api.close)
    const [first, second] = baseProducts.slice(0, 2)
    const items = [first, second].map(product => ({ id: product.id, expectedVersion: 0 }))
    const [batch, edit] = await Promise.allSettled([
      api.setActive(items, false),
      api.update({ id: second.id, expectedVersion: 0, product: { ...second, description: 'Edición de otro administrador' } })
    ])
    const overrides = await api.serviceOverrides()
    if (batch.status === 'fulfilled') {
      assert.equal(edit.reason.code, 'PRODUCT_VERSION_CONFLICT')
      assert.equal(overrides.length, 2)
      assert.ok(overrides.every(product => !product.active))
    } else {
      assert.equal(batch.reason.code, 'PRODUCT_VERSION_CONFLICT')
      assert.equal(edit.status, 'fulfilled')
      assert.deepEqual(overrides, [edit.value])
      assert.ok(edit.value.active)
    }
  })
}
