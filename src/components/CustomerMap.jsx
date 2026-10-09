import React from 'react'
import { customerMapLocation } from '../domain/customers/customer-location.mjs'
import './customer-map.css'

export default function CustomerMap({ customer }) {
  const location = customerMapLocation(customer)
  return <section className="customer-map" aria-label="Ubicación en el mapa">
    <h3>Ubicación en el mapa</h3>
    <p>{location.label}</p>
    {location.address && <p>{location.address}</p>}
    {!location.unresolved && <>
      <iframe key={location.embedUrl} src={location.embedUrl} title="Mapa de ubicación del abonado o cliente" loading="lazy" referrerPolicy="no-referrer" allowFullScreen />
      <a className="secondary" href={location.url} target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
      <small>Si el mapa no carga, podés abrirlo con el enlace. Requiere conexión a Internet.</small>
    </>}
  </section>
}
