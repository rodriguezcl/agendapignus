import catalog from '../../../../shared/product-catalog.cjs'
import { requestJson } from '../../../infrastructure/http/json-request.mjs'

export function createCatalogStore(request = requestJson) {
  let snapshot = { products: catalog.baseProducts, loading: true, canManage: false, error: '' }
  let overrides = new Map()
  let pendingRead
  let generation = 0
  const listeners = new Set()
  const update = fields => {
    snapshot = { ...snapshot, ...fields }
    for (const notify of listeners) notify()
  }
  function refresh() {
    if (pendingRead) return pendingRead
    const current = ++generation
    pendingRead = request('/api/products', { cache: 'no-store' }, 'No se pudo cargar el catálogo de productos.').then(result => {
      if (generation !== current) return
      if (!Array.isArray(result.overrides)) throw new Error('La respuesta del catálogo está incompleta.')
      overrides = new Map(result.overrides.map(product => [product.id, product]))
      update({ products: catalog.mergeCatalog(result.overrides), canManage: result.canManage === true, loading: false, error: '' })
    }).catch(error => {
      if (generation === current) update({ loading: false, error: error.message, ...(error.status === 401 || error.status === 403 ? { canManage: false } : {}) })
    }).finally(() => {
      if (generation === current) pendingRead = undefined
    })
    return pendingRead
  }
  async function saveProduct(command) {
    let result
    try {
      result = await request('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) }, 'No se pudo guardar el producto.')
      if (!result.product?.id) throw new Error('No se recibió la confirmación del producto.')
    } catch (error) {
      if ([401, 403, 409].includes(error.status)) {
        generation++
        pendingRead = undefined
        void refresh()
      }
      throw error
    }
    // A read started before the write may still return the preceding version.
    generation++
    pendingRead = undefined
    const saved = result.product
    if ((overrides.get(saved.id)?.version ?? 0) <= saved.version) overrides.set(saved.id, saved)
    update({ products: catalog.mergeCatalog([...overrides.values()]), error: '' })
    void refresh()
    return saved
  }
  function subscribe(listener) {
    listeners.add(listener)
    if (listeners.size === 1) {
      window.addEventListener('focus', refresh)
      void refresh()
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size) window.removeEventListener('focus', refresh)
    }
  }
  return { getSnapshot: () => snapshot, subscribe, refresh, saveProduct }
}
