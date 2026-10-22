import React, { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { usePermissions } from '../../presentation/contexts/permissions-context.jsx'
import './followups.css'

export default function FollowupSummary({ record }) {
  const { can, user } = usePermissions()
  const [items, setItems] = useState([])
  const root = useRef(null)
  const [visible, setVisible] = useState(false)
  const enabled = Boolean(record?.id && !record.vehicleControl && can('tickets.view'))
  useEffect(() => {
    if (!enabled || !root.current) return
    if (!globalThis.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '80px' })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [enabled, record?.id])
  useEffect(() => {
    setItems([])
    if (!enabled || !visible) return
    let disposed = false
    const refresh = () => requestJson(`/api/tickets?${new URLSearchParams({ serviceId: record.id })}`, { credentials: 'same-origin' })
      .then(data => { if (!disposed) setItems(data.items || []) }).catch(() => { if (!disposed) setItems([]) })
    refresh()
    window.addEventListener('tickets-changed', refresh)
    return () => { disposed = true; window.removeEventListener('tickets-changed', refresh) }
  }, [enabled, visible, record?.id, user?.id])
  const create = can('tickets.fromService') && !record?.vehicleControl ? <button type="button" className="secondary" title="Registrá una nueva solicitud vinculada a este servicio." onClick={()=>window.dispatchEvent(new CustomEvent('open-ticket',{detail:{create:true,serviceId:String(record.id),customerId:String(record.customerId||''),customer:record.customerId?{id:String(record.customerId),name:record.client,account:record.clientAccount}:null}}))}>Nueva solicitud</button> : null
  if (!enabled) return create
  return <section ref={root} className={items.length ? 'followup-summary' : ''} aria-label="Tickets del servicio">{create}{items.map(item => <div key={item.id}><strong>{item.displayNumber} · {item.status}</strong><p>{item.title}</p><small>Responsable: {item.assigneeName || 'Sin asignar'}</small><button type="button" className="secondary" title="Consultá la conversación y las gestiones del ticket." onClick={() => window.dispatchEvent(new CustomEvent('open-ticket', { detail: { ticketId: item.id } }))}>Ver ticket</button></div>)}</section>
}
