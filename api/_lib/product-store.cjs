const { createHash } = require('node:crypto')
const { baseProductsById, mergeCatalog, productKey } = require('../../shared/product-catalog.cjs')
const { EQUIPMENT_KINDS } = require('../../shared/cctv-schema.cjs')
const { validateCctvAttachment } = require('./cctv-attachments.cjs')
const { ensureCommittedSchema } = require('./schema-readiness.cjs')
const { sqlParameters } = require('./ticket-mail-store.cjs')

const table = 'pignus_product_overrides'
const schema = 'CREATE TABLE IF NOT EXISTS ' + table + ' (id TEXT PRIMARY KEY, data TEXT NOT NULL, last_request TEXT NOT NULL, photo_type TEXT, photo_bytes BLOB, CHECK ((photo_type IS NULL) = (photo_bytes IS NULL)))'
const allMetadata = 'SELECT data FROM ' + table + ' ORDER BY id'
const parseMetadata = rows => rows.map(row => JSON.parse(row.data))

// Service saves already own a database connection. Read the catalog on that
// same connection, including on a fresh installation with bundled products only.
function sqliteProductOverrides(db) {
  const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  return present ? parseMetadata(db.prepare(allMetadata).all()) : []
}
async function postgresProductOverrides(transaction) {
  const [result] = await transaction.unsafe('SELECT to_regclass($1) IS NOT NULL AS present', [table])
  return result.present ? parseMetadata(await transaction.unsafe(allMetadata)) : []
}
const upsert = count => 'INSERT INTO ' + table + ' (id,data,last_request,photo_type,photo_bytes) VALUES ' +
  Array(count).fill('(?,?,?,?,?)').join(',') + ' ' +
  'ON CONFLICT (id) DO UPDATE SET data=excluded.data, last_request=excluded.last_request, ' +
  'photo_type=COALESCE(excluded.photo_type,' + table + '.photo_type), photo_bytes=COALESCE(excluded.photo_bytes,' + table + '.photo_bytes)'
const customId = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const imageTypes = ['image/jpeg', 'image/png', 'image/webp']

function fail(message, statusCode = 400, code = 'PRODUCT_INVALID') {
  throw Object.assign(new Error(message), { statusCode, code })
}
function field(value, label, max) {
  if (typeof value !== 'string' || value.trim().length > max) fail('Revisá el campo ' + label + ' (hasta ' + max + ' caracteres).')
  return value.trim()
}
function validateReference(id, expectedVersion) {
  if (typeof id !== 'string' || id.length > 1500 || (!id.startsWith('base:') && !customId.test(id))) fail('Identificador de producto inválido.')
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) fail('La versión del producto no es válida.')
}
function assertVersion(product, expectedVersion) {
  if (expectedVersion !== (product?.version ?? 0)) fail('El producto cambió desde otra sesión. Actualizá el catálogo para revisar los cambios.', 409, 'PRODUCT_VERSION_CONFLICT')
}
function prepare(input, actorId) {
  const { id, expectedVersion, product } = input || {}
  validateReference(id, expectedVersion)
  if (!product || typeof product !== 'object' || Array.isArray(product)) fail('Faltan los datos del producto.')
  const { category, kind, active } = product
  if (typeof category !== 'string' || typeof kind !== 'string' || !Object.hasOwn(EQUIPMENT_KINDS, category) || !Object.hasOwn(EQUIPMENT_KINDS[category], kind)) fail('Elegí una categoría y un tipo de equipo compatibles.')
  if (typeof active !== 'boolean') fail('El estado del producto no es válido.')
  const brand = field(product.brand, 'marca', 100)
  const model = field(product.model, 'modelo', 100)
  if (!model) fail('Ingresá el modelo del producto.')
  const description = field(product.description ?? '', 'descripción', 2000)
  const source = field(product.source ?? '', 'enlace', 2048)
  if (source && !/^https?:\/\//i.test(source)) fail('Ingresá un enlace HTTP o HTTPS válido.')
  if (source) {
    try { new URL(source) } catch { fail('Ingresá un enlace HTTP o HTTPS válido.') }
  }
  let photo = null
  if (Object.hasOwn(input, 'photo')) {
    if (!imageTypes.includes(input.photo?.mimeType)) fail('Elegí una imagen JPG, PNG o WebP de hasta 3 MB.')
    try {
      photo = validateCctvAttachment({ mimeType: input.photo.mimeType, data: input.photo.contentBase64 }, 'addPlan')
    } catch { fail('La imagen debe ser un archivo JPG, PNG o WebP válido de hasta 3 MB.') }
  }
  const fields = { category, kind, brand, model, description, source, active }
  const hash = createHash('sha256').update(JSON.stringify([actorId, id, expectedVersion, fields, photo?.digest || ''])).digest('hex')
  return { id, fields, expectedVersion, hash, photo }
}

function nextProduct(command, rows) {
  const { id, fields, expectedVersion, hash, photo } = command
  const overrides = rows.map(row => JSON.parse(row.data))
  const current = overrides.find(item => item.id === id) || baseProductsById.get(id)
  if (!current && !customId.test(id)) fail('El producto de referencia no existe.', 404, 'PRODUCT_NOT_FOUND')
  if (current && rows.find(row => row.id === id)?.last_request === hash) return { product: current }
  const version = current?.version ?? 0
  assertVersion(current, expectedVersion)
  if (!fields.brand && current?.brand !== '') fail('Ingresá la marca del producto.')
  if (!current && !photo) fail('Adjuntá una imagen de referencia para el nuevo producto.')
  const key = productKey(fields)
  if (mergeCatalog(overrides).some(item => item.id !== id && productKey(item) === key)) {
    fail('Ya existe un producto con esa categoría, marca y modelo. Revisá también los productos inactivos.', 409, 'PRODUCT_DUPLICATE')
  }
  const image = photo ? '/api/products/photo?id=' + encodeURIComponent(id) + '&v=' + photo.digest : current.image
  const product = { id, ...fields, image, caption: photo ? '' : current.caption, version: version + 1 }
  return { product, values: [id, JSON.stringify(product), hash, photo?.mimeType ?? null, photo?.data ?? null] }
}

function prepareStatusChange({ active, items }, actorId) {
  if (typeof active !== 'boolean') fail('El estado del producto no es válido.')
  if (!Array.isArray(items) || !items.length) fail('Seleccioná al menos un producto.')
  const ids = new Set()
  return items.map(item => {
    const { id, expectedVersion } = item || {}
    validateReference(id, expectedVersion)
    if (ids.has(id)) fail('Un producto figura más de una vez en la selección.')
    ids.add(id)
    const hash = createHash('sha256').update(JSON.stringify(['setActive', actorId, id, expectedVersion, active])).digest('hex')
    return { id, active, expectedVersion, hash }
  })
}

function nextStatuses(commands, rows) {
  const catalog = new Map(mergeCatalog(parseMetadata(rows)).map(product => [product.id, product]))
  const lastRequests = new Map(rows.map(row => [row.id, row.last_request]))
  return commands.map(({ id, active, expectedVersion, hash }) => {
    const current = catalog.get(id)
    if (!current) fail('Un producto de la selección ya no está en el catálogo. Actualizá el listado.', 404, 'PRODUCT_NOT_FOUND')
    if (lastRequests.get(id) === hash) return { product: current }
    assertVersion(current, expectedVersion)
    if (current.active === active) return { product: current }
    const product = { ...current, active, version: expectedVersion + 1 }
    return { product, values: [id, JSON.stringify(product), hash, null, null] }
  })
}

function createProductStore({ db, sql }) {
  if (!db && !sql) throw new TypeError('Se necesita una conexión para el catálogo.')
  let sqliteReady = false
  async function ensure() {
    if (sql) return ensureCommittedSchema(sql, 'products-v1', async tx => {
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('pignus-products-schema'))")
      await tx.unsafe(schema.replace('photo_bytes BLOB', 'photo_bytes BYTEA'))
      await tx.unsafe('ALTER TABLE pignus_product_overrides ENABLE ROW LEVEL SECURITY')
      await tx.unsafe('REVOKE ALL ON TABLE pignus_product_overrides FROM PUBLIC')
      await tx.unsafe("DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_product_overrides FROM anon; END IF; IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_product_overrides FROM authenticated; END IF; END $$")
    })
    if (!sqliteReady) { db.exec(schema); sqliteReady = true }
  }
  const rows = (statement, values = []) => sql ? sql.unsafe(sqlParameters(statement), values) : db.prepare(statement).all(...values)
  async function list() {
    await ensure()
    return parseMetadata(await rows(allMetadata))
  }
  async function photo(id) {
    if (typeof id !== 'string') fail('Imagen no encontrada.', 404, 'PRODUCT_PHOTO_NOT_FOUND')
    await ensure()
    const [record] = await rows('SELECT photo_bytes,photo_type FROM pignus_product_overrides WHERE id=? AND photo_type IS NOT NULL', [id])
    if (!record) fail('Imagen no encontrada.', 404, 'PRODUCT_PHOTO_NOT_FOUND')
    return { mimeType: record.photo_type, data: Buffer.from(record.photo_bytes) }
  }
  async function write(plan) {
    await ensure()
    const metadata = 'SELECT id,data,last_request FROM pignus_product_overrides'
    if (sql) return sql.begin(async tx => {
      // Two distinct IDs can compete for the same brand and model, including a seed.
      await tx.unsafe('LOCK TABLE pignus_product_overrides IN SHARE ROW EXCLUSIVE MODE')
      const results = plan(await tx.unsafe(metadata))
      const writes = results.filter(result => result.values)
      // Keep large selections in one transaction with bounded round trips and parameter counts.
      for (let offset = 0; offset < writes.length; offset += 200) {
        const batch = writes.slice(offset, offset + 200)
        await tx.unsafe(sqlParameters(upsert(batch.length)), batch.flatMap(result => result.values))
      }
      return results.map(result => result.product)
    })
    db.exec('BEGIN IMMEDIATE')
    try {
      const results = plan(db.prepare(metadata).all())
      const statement = db.prepare(upsert(1))
      for (const result of results) if (result.values) statement.run(...result.values)
      db.exec('COMMIT')
      return results.map(result => result.product)
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  async function update(input, actorId) {
    const command = prepare(input, actorId)
    const [product] = await write(rows => [nextProduct(command, rows)])
    return product
  }
  async function setActive(input, actorId) {
    const commands = prepareStatusChange(input, actorId)
    return write(rows => nextStatuses(commands, rows))
  }
  return { list, photo, update, setActive }
}

module.exports = { createProductStore, sqliteProductOverrides, postgresProductOverrides }
