import React from 'react'
import Icon from './Icon.jsx'
import useDiscardGuard from './useDiscardGuard.jsx'
import './editor-modal.css'

// Uses the application-wide dialog focus trap, Escape and focus restoration.
export default function EditorModal({ active, title, onClose, busy = false, dirty = false, eyebrow = 'EDITAR REGISTRO', children }) {
  const { requestClose, discardDialog } = useDiscardGuard({ dirty, busy, onDiscard: onClose })
  const content = typeof children === 'function' ? children({ requestClose }) : children
  if (!active) return <>{content}{discardDialog}</>
  return <><div className="modal-layer catalog-editor-layer" onClick={event => {
    if (event.target === event.currentTarget) { event.stopPropagation(); requestClose() }
  }}>
    <section className="modal catalog-editor-modal" role="dialog" aria-modal="true" aria-label={title} aria-busy={busy || undefined}>
      <button title="Cerrá el formulario de edición; si hay cambios, podrás conservarlos o descartarlos." type="button" className="close-modal" aria-label="Cerrar edición" disabled={busy} onClick={requestClose}><Icon name="close" /></button>
      <p className="eyebrow">{eyebrow}</p><h2>{title}</h2>
      {content}
    </section>
  </div>{discardDialog}</>
}
