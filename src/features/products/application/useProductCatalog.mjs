import { useMemo, useSyncExternalStore } from 'react'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { createCatalogStore } from './catalog-store.mjs'

// The editors and their photo pickers share a single request for this session.
let currentSession
let currentStore
export function useProductCatalog() {
  const { user } = usePermissions()
  const session = JSON.stringify([user?.id ?? user?.email ?? null, user?.roleCode ?? user?.role ?? null])
  const store = useMemo(() => {
    if (currentSession !== session) {
      currentSession = session
      currentStore = createCatalogStore()
    }
    return currentStore
  }, [session])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { ...snapshot, refresh: store.refresh, saveProduct: store.saveProduct, setProductsActive: store.setProductsActive }
}
