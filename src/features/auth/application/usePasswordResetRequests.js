import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../../../infrastructure/http/fetch-timeout.mjs'

// One authorized subscription feeds the notification bell and its action dialog.
export function usePasswordResetRequests({ enabled, accountKey }) {
  const [state, setState] = useState({ accountKey: null, requests: [] })
  const [error, setError] = useState('')
  const generation = useRef(0)
  const revision = useRef(0)
  const refreshRef = useRef(() => {})
  useEffect(() => {
    const epoch = ++generation.current
    let loading = false
    setError('')
    setState({ accountKey, requests: [] })
    if (!enabled) return undefined
    const load = async () => {
      if (loading || document.hidden) return
      loading = true
      const startedAtRevision = revision.current
      try {
        const response = await fetchWithTimeout('/api/auth/password-reset-requests', { credentials: 'same-origin', cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (generation.current !== epoch || revision.current !== startedAtRevision) return
        if (response.status === 403) { setState({ accountKey, requests: [] }); return }
        if (!response.ok) throw new Error(data.error || 'No se pudieron consultar las solicitudes.')
        setState({ accountKey, requests: Array.isArray(data.requests) ? data.requests : [] })
      } catch (loadError) {
        console.warn('No se pudieron actualizar las solicitudes de contraseña.', loadError)
      } finally { loading = false }
    }
    refreshRef.current = load
    load()
    const timer = window.setInterval(load, 30000)
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      generation.current++
      refreshRef.current = () => {}
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [enabled, accountKey])

  const resolve = useCallback(async id => {
    if (!enabled) return
    const epoch = generation.current
    try {
      const response = await fetchWithTimeout('/api/auth/password-reset-requests', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const data = await response.json().catch(() => ({}))
      if (generation.current !== epoch) return
      if (!response.ok) throw new Error(data.error || 'No se pudo cerrar la solicitud.')
      // A slower GET may contain the request that this DELETE just resolved.
      revision.current++
      setState(current => ({ ...current, requests: current.requests.filter(item => item.id !== id) }))
      setError('')
    } catch (resolveError) {
      if (generation.current === epoch) setError(resolveError.message || 'No se pudo cerrar la solicitud.')
    }
  }, [enabled])

  return { requests: enabled && state.accountKey === accountKey ? state.requests : [], error: enabled ? error : '', resolve, refresh: () => refreshRef.current() }
}
