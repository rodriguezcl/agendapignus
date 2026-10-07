import React, { useEffect, useId, useRef, useState } from 'react'
import { selectedServiceIds, multiServicePatch } from '../domain/services/multi-service.mjs'
import './service-types-field.css'
import { shouldDismissSelector } from './selector-dismiss.mjs'

export default function ServiceTypesField({ task, services, onChange, disabled = false }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const id = useId()
  const selected = selectedServiceIds(task)
  const options = services
    .filter(service => (service.status === 'Activo' && !service.system) || selected.includes(String(service.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }))
  const summary = options.filter(service => selected.includes(String(service.id))).map(service => service.name).join(' + ') || 'Seleccionar tipos de servicio'
  useEffect(() => {
    if (!open) return
    const closeOutside = event => { if (shouldDismissSelector(root.current, event.target, event.type)) setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    // A label click briefly blurs the trigger before focusing its checkbox.
    // Ignore transient focus on an ancestor dialog; keep outside controls closing it.
    document.addEventListener('focusin', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
    }
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  return <fieldset ref={root} className="service-types-field" aria-labelledby={`${id}-label`} disabled={disabled} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
  }}>
    <span className="service-types-label" id={`${id}-label`}>Tipos de servicio <b>*</b></span>
    <button ref={trigger} type="button" className="service-types-trigger" aria-expanded={open} aria-controls={`${id}-options`} aria-labelledby={`${id}-label ${id}-summary`} title={summary} onClick={() => setOpen(value => !value)}>
      <span id={`${id}-summary`}>{summary}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
    {open && <div id={`${id}-options`} className="service-types-options" role="group" aria-labelledby={`${id}-label`}>
      <small>Marcá una o varias opciones.</small>
      {options.map(service => <label key={service.id} htmlFor={`${id}-service-${service.id}`}>
      <input id={`${id}-service-${service.id}`} type="checkbox" checked={selected.includes(String(service.id))} onChange={event => onChange(multiServicePatch(task, event.target.checked ? [...selected, String(service.id)] : selected.filter(id => id !== String(service.id)), services))} />
      <span>{service.name}</span>
    </label>)}
      <small>Una sola duración, inicio e informe para todos los tipos seleccionados.</small>
    </div>}
  </fieldset>
}
