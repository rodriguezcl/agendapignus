const policy = require('./permission-catalog.cjs')
const { createProductStore } = require('./product-store.cjs')

const stores = new WeakMap()
async function productRequest({ connection, kind, method, route, user, query = {}, input }) {
  if (user?.id == null || user.status === 'Inactivo') throw Object.assign(new Error('Iniciá sesión para consultar Productos.'), { statusCode: 403 })
  const canManage = policy.roleCode(user) === 'administrator'
  const canRead = ['cctv.view', 'planning.create', 'planning.edit'].some(permission => policy.can(user, permission))
  if (!canManage && (method !== 'GET' || !canRead)) {
    throw Object.assign(new Error('No tenés permiso para realizar esta acción en Productos.'), { statusCode: 403 })
  }
  if (!stores.has(connection)) stores.set(connection, createProductStore({ [kind]: connection }))
  const store = stores.get(connection)
  if (route === '/products' && method === 'GET') return { body: { overrides: await store.list(), canManage } }
  if (route === '/products' && method === 'POST') return { body: { product: await store.update(input, user.id) } }
  if (route === '/products/photo' && method === 'GET') return { file: await store.photo(query.id) }
  throw Object.assign(new Error('El método solicitado no está disponible en Productos.'), { statusCode: 405 })
}
function productError(error) {
  const clientStatus = error.message === 'Datos inválidos.' ? 400 : error.statusCode
  const status = clientStatus >= 400 && clientStatus < 500 ? clientStatus : 500
  return { status, body: { error: status < 500 ? error.message : 'No se pudo completar la operación de Productos.', ...(status < 500 && error.code ? { code: error.code } : {}) } }
}
function photoHeaders(file) {
  return { 'Content-Type': file.mimeType, 'Content-Length': file.data.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }
}
module.exports = { productRequest, productError, photoHeaders }
