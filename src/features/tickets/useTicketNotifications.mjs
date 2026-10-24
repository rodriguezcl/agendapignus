import { useEffect, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'

export default function useTicketNotifications({ enabled, userKey }) {
  const [snapshot, setSnapshot] = useState({ userKey: null, items: [] })
  useEffect(() => {
    if (!enabled || !userKey) return
    setSnapshot({ userKey: null, items: [] })
    let disposed = false, running = false
    const refresh = async () => {
      if (disposed || running || document.hidden) return
      running = true
      try {
        const result = await requestJson('/api/tickets?view=notifications', { credentials: 'same-origin' })
        if (!disposed) setSnapshot({ userKey, items: result.notifications || [] })
      } catch (error) {
        // Preserve the last successful snapshot on transient failures.
        if (!disposed && [401, 403].includes(error.status)) setSnapshot({ userKey: null, items: [] })
      } finally { running = false }
    }
    refresh()
    const interval = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    window.addEventListener('tickets-changed', refresh)
    return () => { disposed = true; clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('tickets-changed', refresh) }
  }, [enabled, userKey])
  return { items: enabled && snapshot.userKey === userKey ? snapshot.items : [], ready: Boolean(enabled && snapshot.userKey === userKey) }
}
