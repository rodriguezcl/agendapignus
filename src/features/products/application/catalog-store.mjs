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
  async function write(command, bulk) {
    let saved
    try {
      const result = await request('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) }, 'No se pudieron guardar los cambios en Productos.')
      if (bulk) {
        saved = result.products
        const confirmed = Array.isArray(saved) && saved.length === command.items.length &&
          command.items.every(({ id }, i) => saved[i]?.id === id && saved[i].active === command.active)
        if (!confirmed) throw new Error('No se recibió la confirmación de todos los productos.')
      } else {
        if (!result.product?.id) throw new Error('No se recibió la confirmación del producto.')
        saved = [result.product]
      }
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
    for (const product of saved) {
      if ((overrides.get(product.id)?.version ?? 0) <= product.version) overrides.set(product.id, product)
    }
    update({ products: catalog.mergeCatalog([...overrides.values()]), error: '' })
    void refresh()
    return saved
  }
  async function saveProduct(command) {
    const [saved] = await write(command, false)
    return saved
  }
  function setProductsActive(items, active) {
    return write({ action: 'setActive', items, active }, true)
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
  return { getSnapshot: () => snapshot, subscribe, refresh, saveProduct, setProductsActive }
}
