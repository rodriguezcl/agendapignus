import React from 'react'
import { selectedServiceIds, multiServicePatch } from '../domain/services/multi-service.mjs'
import './service-types-field.css'

export default function ServiceTypesField({ task, services, onChange, disabled = false }) {
  const selected = selectedServiceIds(task)
  const options = services.filter(service => (service.status === 'Activo' && !service.system) || selected.includes(String(service.id)))
  return <fieldset className="service-types-field" disabled={disabled}>
    <legend>Tipos de servicio *</legend>
    <div>{options.map(service => <label key={service.id}>
      <input type="checkbox" checked={selected.includes(String(service.id))} onChange={event => onChange(multiServicePatch(task, event.target.checked ? [...selected, String(service.id)] : selected.filter(id => id !== String(service.id)), services))} />
      <span>{service.name}</span>
    </label>)}</div>
    <small>Una sola duración, inicio e informe para todos los tipos seleccionados.</small>
  </fieldset>
}
