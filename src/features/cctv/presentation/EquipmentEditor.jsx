import React, { useEffect, useRef, useState } from 'react'
import schema from '../../../../shared/cctv-schema.cjs'
import { changeEquipmentKind, newEquipmentItem, removeEquipment, reorderEquipment } from '../domain/equipment.mjs'
import './cctv-editors.css'

export function EquipmentEditor({ value = [], onChange, readOnly = false, disabled = false }) {
  const items = Array.isArray(value) ? value : []
  const [category, setCategory] = useState('cctv'), [removed, setRemoved] = useState(null)
  const lastRemoval = useRef(null)
  const lastOutput = useRef(value)
  useEffect(() => { if (value !== lastOutput.current) { lastRemoval.current = null; setRemoved(null) } lastOutput.current = value }, [value])
  const locked = readOnly || disabled
  const change = next => { if (!locked) { lastOutput.current = next; onChange?.(next) } }
  const update = (id, patch) => change(items.map(item => item.id === id ? { ...item, ...patch } : item))
  function remove(item) {
    const remaining = removeEquipment(items, item.id)
    lastRemoval.current = { item, index: items.indexOf(item), remaining }
    setRemoved(item.label || schema.EQUIPMENT_KINDS[item.category]?.[item.kind] || 'Equipo'); change(remaining)
  }
  function restore() {
    const entry = lastRemoval.current
    if (!entry || items.some(item => item.id === entry.item.id)) return
    const next = [...items]; next.splice(Math.min(entry.index, next.length), 0, entry.item); change(next); setRemoved(null); lastRemoval.current = null
  }
  return <section className="cctv-equipment-editor" aria-label="Equipos de la instalación">
    {!readOnly && <p className="cctv-editor-help">Registrá los equipos y sus características. No cargues contraseñas ni claves de acceso.</p>}
    {!items.length && <p className="cctv-editor-empty">Todavía no hay equipos registrados.</p>}
    <div className="cctv-equipment-list">{items.map((item, index) => {
      const kindLabel = schema.EQUIPMENT_KINDS[item.category]?.[item.kind] || item.kind
      const fields = schema.DETAILS_BY_KIND[item.kind] || []
      return <details className="cctv-equipment-card" key={item.id} open={readOnly || items.length < 4}>
        <summary><strong>{item.label || kindLabel}</strong><span>{schema.EQUIPMENT_CATEGORIES[item.category]} · {item.quantity || 1} unidad(es){item.location ? ` · ${item.location}` : ''}</span></summary>
        {readOnly ? <dl className="cctv-equipment-facts">
          {[['Tipo', kindLabel], ['Marca', item.brand], ['Modelo', item.model], ['Cantidad', item.quantity], ['Ubicación', item.location], ...fields.map(key => [schema.FIELD_DEFINITIONS[key].label, item.details?.[key]]), ['Observaciones', item.notes]].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}
        </dl> : <div className="cctv-equipment-fields">
          <div className="cctv-editor-grid">
            <label>Categoría<select aria-label="Categoría" disabled={disabled} value={item.category} onChange={event => update(item.id, changeEquipmentKind(item, event.target.value))}>{Object.entries(schema.EQUIPMENT_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Tipo de equipo<select aria-label="Tipo de equipo" disabled={disabled} value={item.kind} onChange={event => update(item.id, changeEquipmentKind(item, item.category, event.target.value))}>{Object.entries(schema.EQUIPMENT_KINDS[item.category] || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Nombre / referencia<input disabled={disabled} maxLength="160" value={item.label || ''} onChange={event => update(item.id, { label: event.target.value })} placeholder="Ej.: cámara de ingreso" /></label>
            <label>Cantidad<input disabled={disabled} type="number" min="1" max="10000" step="1" value={item.quantity ?? ''} onChange={event => update(item.id, { quantity: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
            <label>Marca<input disabled={disabled} maxLength="100" value={item.brand || ''} onChange={event => update(item.id, { brand: event.target.value })} /></label>
            <label>Modelo<input disabled={disabled} maxLength="100" value={item.model || ''} onChange={event => update(item.id, { model: event.target.value })} /></label>
            <label className="cctv-editor-full">Ubicación<input disabled={disabled} maxLength="250" value={item.location || ''} onChange={event => update(item.id, { location: event.target.value })} /></label>
            {fields.map(key => {
              const field = schema.FIELD_DEFINITIONS[key], value = item.details?.[key] ?? ''
              const set = value => update(item.id, { details: { ...(item.details || {}), [key]: value } })
              return <label key={key}>{field.label}{field.type === 'select' ? <select aria-label={field.label} disabled={disabled} value={value} onChange={event => set(event.target.value)}><option value="">Sin especificar</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : <input disabled={disabled} type={field.type} min={field.min} max={field.max} maxLength={field.maxLength} step={field.type === 'number' ? field.integer ? '1' : 'any' : undefined} value={value} onChange={event => set(field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />}</label>
            })}
          </div>
          <label>Observaciones<textarea aria-label="Observaciones" disabled={disabled} maxLength="3000" rows="3" value={item.notes || ''} onChange={event => update(item.id, { notes: event.target.value })} /></label>
          <div className="cctv-editor-toolbar" role="group" aria-label={`Acciones del equipo ${index + 1}`}>
            <button type="button" disabled={disabled || index === 0} onClick={() => change(reorderEquipment(items, item.id, -1))} aria-label={`Subir ${item.label || kindLabel}`}>Subir</button>
            <button type="button" disabled={disabled || index === items.length - 1} onClick={() => change(reorderEquipment(items, item.id, 1))} aria-label={`Bajar ${item.label || kindLabel}`}>Bajar</button>
            <button type="button" disabled={disabled} onClick={() => remove(item)}>Quitar equipo</button>
          </div>
        </div>}
      </details>
    })}</div>
    {!readOnly && <>
      {removed && <div className="cctv-editor-undo" role="status"><span>Se quitó: {removed}.</span><button type="button" disabled={disabled || items.length >= schema.MAX_EQUIPMENT_ITEMS} onClick={restore}>Deshacer eliminación</button></div>}
      <div className="cctv-equipment-add"><label>Agregar equipo de<select aria-label="Agregar equipo de" disabled={disabled} value={category} onChange={event => setCategory(event.target.value)}>{Object.entries(schema.EQUIPMENT_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" disabled={disabled || items.length >= schema.MAX_EQUIPMENT_ITEMS} onClick={() => change([...items, newEquipmentItem(category)])}>+ Agregar equipo</button><span>{items.length} / {schema.MAX_EQUIPMENT_ITEMS} equipos</span></div>
    </>}
  </section>
}
export default EquipmentEditor
