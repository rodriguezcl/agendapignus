import React, { useEffect, useId, useRef, useState } from 'react'
import { selectedServiceIds, multiServicePatch } from '../domain/services/multi-service.mjs'
import './service-types-field.css'

export default function ServiceTypesField({ task, services, onChange, disabled = false }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const id = useId()
  const selected = selectedServiceIds(task)
  const options = services.filter(service => (service.status === 'Activo' && !service.system) || selected.includes(String(service.id)))
  const summary = options.filter(service => selected.includes(String(service.id))).map(service => service.name).join(' + ') || 'Seleccionar tipos de servicio'
  useEffect(() => {
    if (!open) return
    const closeOutside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  return <fieldset ref={root} className="service-types-field" disabled={disabled} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
  }}>
    <legend id={`${id}-label`}>Tipos de servicio *</legend>
    <button ref={trigger} type="button" className="service-types-trigger" aria-expanded={open} aria-controls={`${id}-options`} aria-labelledby={`${id}-label ${id}-summary`} title={summary} onClick={() => setOpen(value => !value)}>
      <span id={`${id}-summary`}>{summary}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
    {open && <div id={`${id}-options`} className="service-types-options" role="group" aria-labelledby={`${id}-label`}>
      <small>Marcá una o varias opciones.</small>
      {options.map(service => <label key={service.id}>
      <input type="checkbox" checked={selected.includes(String(service.id))} onChange={event => onChange(multiServicePatch(task, event.target.checked ? [...selected, String(service.id)] : selected.filter(id => id !== String(service.id)), services))} />
      <span>{service.name}</span>
    </label>)}
      <small>Una sola duración, inicio e informe para todos los tipos seleccionados.</small>
    </div>}
  </fieldset>
}
