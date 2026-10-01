import React from 'react'
import Icon from './Icon.jsx'
import './editor-modal.css'

// Uses the application-wide dialog focus trap, Escape and focus restoration.
export default function EditorModal({ active, title, onClose, busy = false, eyebrow = 'EDITAR REGISTRO', children }) {
  if (!active) return children
  return <div className="modal-layer catalog-editor-layer" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <section className="modal catalog-editor-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button title="Cerrá el formulario de edición y volvé al listado." type="button" className="close-modal" aria-label="Cerrar edición" disabled={busy} onClick={onClose}><Icon name="close" /></button>
      <p className="eyebrow">{eyebrow}</p><h2>{title}</h2>
      {children}
    </section>
  </div>
}
