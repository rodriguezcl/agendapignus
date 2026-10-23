const { can } = require('./permission-catalog.cjs')
const stores = new WeakMap()
function storeFor(connection, kind) {
  if (!stores.has(connection)) stores.set(connection, require('./tickets-store.cjs').createTicketStore({ [kind]: connection }))
  return stores.get(connection)
}
async function ticketRequest({ connection, kind, user, state, method, route, query = {}, input = {}, formState }) {
  const store = storeFor(connection, kind)
  if (route === '/tickets/mail') {
    const service = require('./ticket-mail-service.cjs').createMailService({ [kind]: connection, ticketStore: store })
    return { body: await service.request({ method, input, user, state }) }
  }
  if (!can(user, 'tickets.view') && !can(user, 'tickets.configure')) throw Object.assign(new Error('No tenés permiso para consultar tickets.'), { statusCode: 403 })
  await store.syncLegacy(state)
  if (route === '/tickets/attachments' && method === 'GET') {
    const file = await store.attachment(user, state, { id: query.id, attachmentId: query.attachmentId })
    return { file }
  }
  if (route === '/tickets/config') {
    if (!can(user, 'tickets.configure')) throw Object.assign(new Error('No tenés permiso para configurar tickets.'), { statusCode: 403 })
    if(!['GET','POST'].includes(method))throw Object.assign(new Error('Método no permitido.'),{statusCode:405})
    return { body: method === 'GET' ? await store.query(user, state, { mode: 'metadata' }) : await store.run(user, state, { ...input, action: 'configure' }) }
  }
  if (route !== '/tickets' || !['GET', 'POST'].includes(method)) throw Object.assign(new Error('Ruta de tickets no disponible.'), { statusCode: 405 })
  if (method === 'POST') return { body: await store.run(user, state, input, formState) }
  const mode = query.view || (query.id ? 'detail' : 'list')
  return { body: await store.query(user, state, { ...query, mode, search: query.search || query.q || '' }) }
}
function ticketError(error) {
  const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
  return { status, body: { error: status < 500 ? error.message : 'No se pudo completar la operación de tickets.', ...(error.code ? { code: error.code } : {}), ...(error.candidates ? { candidates: error.candidates } : {}), ...(error.duplicateToken ? { duplicateToken: error.duplicateToken } : {}) } }
}
function attachmentHeaders(file) {
  const name = file.fileName || file.name || 'adjunto'
  return { 'Content-Type': file.mimeType || file.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename="adjunto"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" }
}
module.exports = { ticketRequest, ticketError, attachmentHeaders, storeFor }
