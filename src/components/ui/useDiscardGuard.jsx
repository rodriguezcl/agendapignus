import React, { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

// Only user-initiated exits use this guard. Successful saves can still close directly.
export default function useDiscardGuard({ dirty, busy = false, onDiscard, title = 'Cambios sin guardar' }) {
  const [confirming, setConfirming] = useState(false)
  const pendingAction = useRef(null)
  const requestClose = useCallback(actionOverride => {
    if (busy) return
    const action = typeof actionOverride === 'function' ? actionOverride : onDiscard
    if (!dirty) { action?.(); return }
    pendingAction.current = action
    setConfirming(true)
  }, [busy, dirty, onDiscard])
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
  const discardDialog = confirming && <div className="modal-layer catalog-discard-layer" onClick={event => {
    if (event.target === event.currentTarget) { event.stopPropagation(); if (!busy) keepEditing() }
  }}>
    <section className="modal confirm-modal catalog-discard-modal" role="alertdialog" aria-modal="true" aria-label={title}>
      <button type="button" className="close-modal" aria-label="Seguir editando" title="Volvé al formulario sin descartar los cambios." disabled={busy} onClick={keepEditing}><Icon name="close" /></button>
      <h2>{title}</h2><p>Los cambios que cargaste todavía no se guardaron. Podés seguir editando o descartarlos para cerrar.</p>
      <div className="confirm-actions">
        <button type="button" className="secondary" title="Volvé al formulario y conservá los cambios sin guardar." disabled={busy} onClick={keepEditing}>Seguir editando</button>
        <button type="button" className="danger-button" title="Descartá los cambios de este formulario y continuá." disabled={busy} onClick={discard}>Descartar cambios</button>
      </div>
    </section>
  </div>
  return { requestClose, discardDialog }
}
