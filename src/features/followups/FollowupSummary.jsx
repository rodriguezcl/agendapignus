import React from 'react'
import { usePermissions } from '../../presentation/contexts/permissions-context.jsx'
import './followups.css'

export default function FollowupSummary({ record }) {
  const { can } = usePermissions()
  const item = record?.followup
  if (!item || !can('followups.view')) return null
  return <section className="followup-summary" aria-label="Seguimiento del servicio"><strong>Seguimiento · {item.status}</strong><p>{item.type}: {item.description}</p><small>Responsable: {item.assigneeName || 'Sin asignar'}</small><details><summary>Ver gestiones</summary><ol>{item.events.map((event, index) => <li key={index}><b>{event.action}</b> · {event.byName} · {new Date(event.at).toLocaleString('es-AR')}<p>{event.note}</p></li>)}</ol></details></section>
}
