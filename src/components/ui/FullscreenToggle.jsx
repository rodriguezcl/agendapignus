import React, { useEffect, useId, useRef, useState } from 'react'

function fullscreenAvailable() {
  return typeof document !== 'undefined' && Boolean(document.fullscreenEnabled) &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof document.exitFullscreen === 'function'
}

export default function FullscreenToggle() {
  const [available, setAvailable] = useState(fullscreenAvailable)
  const [active, setActive] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const errorId = useId()
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const sync = () => {
      setAvailable(fullscreenAvailable())
      setActive(Boolean(document.fullscreenElement))
    }
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => {
      mounted.current = false
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [])

  const toggle = async () => {
    if (busy || !fullscreenAvailable()) return
    const leaving = Boolean(document.fullscreenElement)
    setError('')
    setBusy(true)
    try {
      if (leaving) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
      if (mounted.current) setActive(Boolean(document.fullscreenElement))
    } catch {
      if (mounted.current) setError(leaving
        ? 'No se pudo salir de pantalla completa. Podés presionar Esc.'
        : 'El navegador no permitió abrir la pantalla completa. Podés volver a intentarlo.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  // Unsupported browsers retain the normal responsive layout without a dead action.
  if (!available) return null
  const label = active ? 'Salir de pantalla completa' : 'Entrar en pantalla completa'
  return <span className="topbar-fullscreen">
    <button type="button" className="topbar-icon-button" title={active ? `${label} (Esc)` : label} aria-label={label} aria-pressed={active} aria-describedby={error ? errorId : undefined} disabled={busy} onClick={toggle}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d={active ? 'M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'} />
      </svg>
    </button>
    {error && <span id={errorId} className="fullscreen-feedback" role="alert">{error}</span>}
  </span>
}
