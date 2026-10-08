import React, { useEffect, useId, useRef, useState } from 'react'
import { shouldDismissSelector } from './selector-dismiss.mjs'
import './service-types-field.css'

export default function TeamTechniciansField({ label, technicians, memberIds = [], onChange }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const id = useId()
  const selected = memberIds.map(String)
  const options = [...technicians].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }))
  const summary = selected.map(memberId => options.find(tech => String(tech.id) === memberId)?.name || 'Técnico no disponible').join(' / ') || 'Seleccionar técnicos'
  useEffect(() => {
    if (!open) return
    const closeOutside = event => { if (shouldDismissSelector(root.current, event.target, event.type)) setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
    }
  }, [open])
  return <fieldset ref={root} className="service-types-field team-technicians-field" aria-labelledby={`${id}-label`} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
    }
  }}>
    <span className="service-types-label" id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className="service-types-trigger" aria-expanded={open} aria-controls={`${id}-options`} aria-labelledby={`${id}-label ${id}-summary`} title={summary} onClick={() => setOpen(value => !value)}>
      <span id={`${id}-summary`}>{summary}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
    {open && <div id={`${id}-options`} className="service-types-options" role="group" aria-labelledby={`${id}-label`}>
      <small>Marcá los técnicos que integran este equipo.</small>
      {options.map(tech => <label key={tech.id} htmlFor={`${id}-tech-${tech.id}`}>
        <input id={`${id}-tech-${tech.id}`} type="checkbox" checked={selected.includes(String(tech.id))} onChange={event => onChange(event.target.checked ? [...selected, String(tech.id)] : selected.filter(memberId => memberId !== String(tech.id)))} />
        <span>{tech.name}</span>
      </label>)}
      {!options.length && <small>No hay técnicos disponibles.</small>}
    </div>}
  </fieldset>
}
