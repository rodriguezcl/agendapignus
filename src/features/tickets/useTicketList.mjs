import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { createTicketListRefresh } from './ticket-list-refresh.mjs'

export default function useTicketList({ accessKey, enabled, params, paused }) {
  const controller = useRef(null), pause = useRef(paused)
  pause.current = paused
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '')).toString()
  const key = `${accessKey}:${query}`
  const [snapshot, setSnapshot] = useState(null)
  useEffect(() => {
    if (!enabled) return
    const list = createTicketListRefresh({
      fetchList: signal => requestJson(`/api/tickets?view=list&${query}`, { signal }),
      onChange: value => setSnapshot({ key, ...value })
    })
    controller.current = list
    list.refresh()
    const refresh = () => { if (!document.hidden && !pause.current) list.refresh({ background: true }) }
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      list.dispose()
      controller.current = null
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [key, query, enabled])
  const value = enabled && snapshot?.key === key ? snapshot : { data: { items: [], total: 0, counts: {} }, loading: enabled, refreshing: false, pending: null, error: '' }
  return { ...value, refresh: () => controller.current?.refresh(), apply: () => controller.current?.apply() }
}
