import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'

// Only user-initiated exits use this guard. Successful saves can still close directly.
export default function useDiscardGuard({ dirty, busy = false, onDiscard, title = 'Cambios sin guardar', confirmAlways = false }) {
  const [confirming, setConfirming] = useState(false)
  const dialogRef = useRef(null)
  const portalTarget = useRef(null)
  const [layerIndex, setLayerIndex] = useState(2000)
  const pendingAction = useRef(null)
  const requestClose = useCallback(actionOverride => {
    if (busy) return
    const action = typeof actionOverride === 'function' ? actionOverride : onDiscard
    if (!dirty && !confirmAlways) { action?.(); return }
    portalTarget.current = document.activeElement?.closest('.app-shell,.audit-shell') || document.querySelector('.app-shell,.audit-shell') || document.body
    const indexes = [...document.querySelectorAll('.modal-layer,.modal-backdrop')].map(element => Number.parseInt(getComputedStyle(element).zIndex, 10) || 0)
    setLayerIndex(Math.max(2000, ...indexes) + 10)
    pendingAction.current = action
    setConfirming(true)
  }, [busy, dirty, onDiscard, confirmAlways])
  useEffect(() => {
    if (!confirming) return
    const opener = document.activeElement
    dialogRef.current?.querySelector('.secondary')?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [confirming])
  useEffect(() => {
    if (!dirty && !busy) return undefined
    const beforeNavigate = event => {
      if (event.defaultPrevented) return
      event.preventDefault()
      if (busy) { event.detail?.onBlocked?.(); return }
      requestClose(() => {
        onDiscard?.()
        event.detail?.proceed?.()
      })
    }
    const beforeUnload = event => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('pignus:before-navigate', beforeNavigate)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('pignus:before-navigate', beforeNavigate)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [busy, dirty, onDiscard, requestClose])
  const keepEditing = () => { pendingAction.current = null; setConfirming(false) }
  const discard = () => {
    if (busy) return
    const action = pendingAction.current
    pendingAction.current = null
    setConfirming(false)
    action?.()
  }
  const discardDialog = confirming && createPortal(<div className="modal-layer catalog-discard-layer" style={{ zIndex: layerIndex }} onClick={event => {
    if (event.target === event.currentTarget) { event.stopPropagation(); if (!busy) keepEditing() }
  }}>
    <section ref={dialogRef} className="modal confirm-modal catalog-discard-modal" role="alertdialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.isComposing) return
      if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!busy && !event.repeat) { if (event.key === 'Escape') keepEditing(); else discard() } }
      if (event.key === 'Tab') { const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled)')]; if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() } }
    }}>
      <button type="button" className="close-modal" aria-label="Seguir editando" title="Volvé al formulario sin descartar los cambios." disabled={busy} onClick={keepEditing}><Icon name="close" /></button>
      <h2>{title}</h2><p>{dirty ? 'Los cambios que cargaste todavía no se guardaron. Podés seguir editando o descartarlos para cerrar.' : 'Se cerrará el formulario sin crear el ticket. ¿Querés confirmar la cancelación?'}</p>
      <div className="confirm-actions">
        <button type="button" className="secondary" title="Volvé al formulario y conservá los cambios sin guardar." disabled={busy} onClick={keepEditing}>Seguir editando</button>
        <button type="button" className="danger-button" title="Descartá los cambios de este formulario y continuá." disabled={busy} onClick={discard}>{dirty ? 'Descartar cambios' : 'Confirmar cancelación'}</button>
      </div>
    </section>
  </div>, portalTarget.current || document.body)
  return { requestClose, discardDialog, confirming }
}
