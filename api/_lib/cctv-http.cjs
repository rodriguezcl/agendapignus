const stores = new WeakMap()
function storeFor(connection, kind) {
  if (!['db', 'sql'].includes(kind)) throw new TypeError('Tipo de conexión no válido.')
  if (!stores.has(connection)) stores.set(connection, require('./cctv-store.cjs').createCctvStore({ [kind]: connection }))
  return stores.get(connection)
}
async function cctvRequest({ connection, kind, user, state, method, route, query = {}, input = {} }) {
  const store = storeFor(connection, kind)
  if (route === '/cctv/attachments' && method === 'GET') return { file: await store.attachment(user, state, query.customerId, query.attachmentId) }
  if (route === '/cctv' && method === 'GET') return { body: query.customerId ? await store.detail(user, state, query.customerId) : await store.list(user, state) }
  if (route === '/cctv' && method === 'POST') return { body: await store.run(user, state, input) }
  throw Object.assign(new Error('La ruta o el método de Servicios de CCTV no está disponible.'), { statusCode: 405 })
}
function cctvError(error) {
  const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
  return { status, body: { error: status < 500 ? error.message : 'No se pudo completar la operación de Servicios de CCTV.', ...(error.code ? { code: error.code } : {}), ...(Number.isSafeInteger(error.currentVersion) ? { currentVersion: error.currentVersion } : {}) } }
}
module.exports = { cctvRequest, cctvError, attachmentHeaders: require('./tickets-http.cjs').attachmentHeaders, storeFor }
