import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { customerMapLocation } from '../domain/customers/customer-location.mjs'
import CustomerMap from './CustomerMap.jsx'
import EditorModal from './ui/EditorModal.jsx'
import './technician-service-map.css'

export default function TechnicianServiceMap({ record }) {
  const [expanded, setExpanded] = useState(false)
  const location = customerMapLocation(record)
  if (location.unresolved) return <section className="technician-map-unavailable"><small>{location.label}</small></section>
  return <section className="technician-map-cover" aria-label={`Mapa de ${record.client || 'servicio'}`}>
    <div className="technician-map-preview">
      <iframe key={location.embedUrl} src={location.embedUrl} title="Vista previa de ubicación" loading="lazy" referrerPolicy="no-referrer" tabIndex={-1} aria-hidden="true" />
      <button type="button" className="secondary" onClick={() => setExpanded(true)}>Ampliar mapa</button>
    </div>
    <small>{location.label}</small>
    {expanded && createPortal(<EditorModal active title={record.client || 'Ubicación del servicio'} eyebrow="MAPA DEL SERVICIO" onClose={() => setExpanded(false)}>
      <CustomerMap customer={record} />
    </EditorModal>, document.body)}
  </section>
}
