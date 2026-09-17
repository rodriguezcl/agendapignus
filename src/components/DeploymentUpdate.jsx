import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

// Independent banner covers the technician, help and login shells too.
export function useDeploymentUpdate({ active, busy, guard, logout }) {
  const latest = useRef({ active, busy, guard, logout })
  latest.current = { active, busy, guard, logout }
  const [available, setAvailable] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const detected = useRef(false)
  const edited = useRef(new Set())
  const bannerRoot = useRef(null)

  const reload = async () => {
    if (running.current || latest.current.busy) return
    running.current = true
    setError('')
    try {
      if (latest.current.active) await latest.current.logout({ requireServerLogout: true })
      window.location.reload()
    } catch (error) {
      running.current = false
      setError(error.message || 'No se pudo actualizar. Reintentá cuando tengas conexión.')
    }
  }
  const proceed = () => {
    if (latest.current.busy || running.current) return
    const unguardedModal = [...document.querySelectorAll('.modal')].some(modal =>
      !modal.matches('.weekly-task-modal, .unsaved-service-modal') && modal.querySelector('input, textarea, select'))
    if (unguardedModal) {
      setError('Guardá o cancelá el formulario abierto antes de actualizar. La página no se recargará mientras lo editás.')
      return
    }
    // Existing guards retain validation, discard and focus behavior for agenda drafts.
    if (latest.current.guard.current) latest.current.guard.current(reload)
    else {
      const hasEditor = [...edited.current].some(element => element.isConnected) ||
        document.querySelector('.modal input, .modal textarea, .modal select')
      if (!hasEditor) void reload()
      else setError('Terminá de guardar o cancelá el formulario abierto y luego presioná Actualizar. Tus datos no se recargarán mientras lo editás.')
    }
  }
  const proceedRef = useRef(proceed)
  proceedRef.current = proceed
  useEffect(() => {
    if (!import.meta.env.PROD) return
    let stopped = false, checking = false
    const capture = event => {
      if (event.target.matches('input, textarea, select')) edited.current.add(event.target)
    }
    const check = async () => {
      if (checking || stopped || document.visibilityState === 'hidden') return
      if (detected.current) return
      checking = true
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const version = await response.json()
        if (!stopped && typeof version.buildId === 'string' && version.buildId && version.buildId !== __APP_BUILD_ID__) {
          detected.current = true
          setAvailable(true)
          // Give blur handlers an opportunity to commit buffered inputs.
          document.activeElement?.blur?.()
          setTimeout(() => { if (!stopped) proceedRef.current() }, 100)
        }
      } catch { /* Offline or invalid manifests must never force a logout. */ }
      finally { clearTimeout(timeout); checking = false }
    }
    document.addEventListener('input', capture, true)
    document.addEventListener('change', capture, true)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    const interval = setInterval(check, 60000)
    void check()
    return () => {
      stopped = true
      clearInterval(interval)
      document.removeEventListener('input', capture, true)
      document.removeEventListener('change', capture, true)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  useEffect(() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    bannerRoot.current = createRoot(host)
    return () => { const root = bannerRoot.current; bannerRoot.current = null; queueMicrotask(() => { root.unmount(); host.remove() }) }
  }, [])

  useEffect(() => { bannerRoot.current?.render(available ? <aside role="alert" style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: 'white', color: '#173c2c', border: '1px solid #bbcebf', borderRadius: 12, padding: 16, width: 'min(600px, 94vw)', boxShadow: '0 4px 24px #0003' }}>
    <b>Nueva versión disponible</b>
    <p>{error || 'Guardá o cancelá los cambios pendientes antes de actualizar. Luego deberás ingresar nuevamente.'}</p>
    <button type="button" className="primary" disabled={busy} onClick={() => { document.activeElement?.blur?.(); setTimeout(() => proceedRef.current(), 100) }}>Actualizar</button>
  </aside> : null) }, [available, error, busy])
}
