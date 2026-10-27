import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../infrastructure/http/json-request.mjs'

const endpoint = '/api/push/subscription'
const post = input => requestJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
const decodeKey = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0))
export default function useWebPush(userKey) {
  const preferenceKey = `pignus:notification-push:${encodeURIComponent(userKey || 'local')}`
  const remember = value => { try { localStorage.setItem(preferenceKey, value) } catch { /* The current subscription remains usable. */ } }
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(true), [message, setMessage] = useState('')
  const config = useRef(null), registration = useRef(null), alive = useRef(false), operation = useRef(null)
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const needsHome = ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches
  const supported = !needsHome && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  useEffect(() => {
    alive.current = true
    let canceled = false, running = false
    setEnabled(false); setBusy(true); setMessage('')
    config.current = null; registration.current = null
    if (!supported) { setBusy(false); return () => { alive.current = false } }
    const init = async () => {
      if (canceled || running || operation.current) return
      running = true
      const token = {}; operation.current = token; setBusy(true)
      try {
        const settings = await requestJson(endpoint)
        if (canceled) return
        if (!settings.available) { setMessage('Las notificaciones del dispositivo todavía no están disponibles.'); return }
        config.current = settings
        const worker = await navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' })
        await navigator.serviceWorker.ready
        if (canceled) return
        registration.current = worker
        let preference = null
        try { preference = localStorage.getItem(preferenceKey) } catch { /* Existing server consent can still be read. */ }
        let subscription = await worker.pushManager.getSubscription()
        if (canceled) return
        // Remember consent per account/browser, while logout still revokes delivery.
        // Re-enroll only this authenticated account, without prompting again.
        if (preference === 'off') { setEnabled(false); return }
        if (subscription && Notification.permission === 'granted') {
          const state = await post({ action: 'status', endpoint: subscription.endpoint })
          if (canceled) return
          if (state.enabled === true) { remember('on'); setEnabled(true); setMessage(''); return }
        }
        if (preference === 'on' && Notification.permission === 'granted') {
          subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(settings.publicKey) })
          if (canceled) return
          await post({ action: 'subscribe', subscription: subscription.toJSON() })
          if (!canceled) { setEnabled(true); setMessage('') }
        } else if (preference === 'on' && Notification.permission === 'denied') {
          setMessage('Tu preferencia está guardada, pero el navegador bloqueó las notificaciones. Permitilas en los ajustes de este sitio o aplicación.')
        }
      } catch { if (!canceled) setMessage('No se pudo conectar el dispositivo. Tu preferencia se conserva; reintentaremos cuando vuelvas a la plataforma o recuperes la conexión.') }
      finally { running = false; if (operation.current === token) operation.current = null; if (!canceled) setBusy(false) }
    }
    void init()
    window.addEventListener('online', init)
    window.addEventListener('focus', init)
    return () => { canceled = true; alive.current = false; operation.current = null; window.removeEventListener('online', init); window.removeEventListener('focus', init) }
  }, [userKey, supported, preferenceKey])
  const activate = async () => {
    if (busy || operation.current || !registration.current || !config.current) return
    const token = {}; operation.current = token
    setBusy(true); setMessage('')
    try {
      // This must happen directly in the click handler, especially on iOS.
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Las notificaciones están bloqueadas. Permitilas en los ajustes de notificaciones de este sitio o aplicación.' : 'No se activaron las notificaciones. Podés volver a intentarlo.')
      const subscription = await registration.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.current.publicKey) })
      if (!alive.current) return
      await post({ action: 'subscribe', subscription: subscription.toJSON() })
      if (alive.current) { remember('on'); setEnabled(true); setMessage('Activadas. Recordaremos tu elección para este usuario y navegador al volver a ingresar.') }
    } catch (error) { if (alive.current) setMessage(error.message || 'No se pudieron activar las notificaciones.') }
    finally { if (operation.current === token) operation.current = null; if (alive.current) setBusy(false) }
  }
  const deactivate = async () => {
    if (busy || operation.current) return
    const token = {}; operation.current = token
    setBusy(true); setMessage('')
    try {
      const subscription = await registration.current?.pushManager.getSubscription()
      if (subscription) {
        await requestJson(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) })
        remember('off')
        await subscription.unsubscribe().catch(() => false)
      }
      if (alive.current) { remember('off'); setEnabled(false); setMessage('Notificaciones desactivadas. Recordaremos tu elección en este navegador.') }
    } catch (error) { if (alive.current) setMessage(error.message) }
    finally { if (operation.current === token) operation.current = null; if (alive.current) setBusy(false) }
  }
  const test = async () => {
    if (busy || operation.current) return
    const token = {}; operation.current = token
    setBusy(true); setMessage('')
    try {
      const subscription = await registration.current?.pushManager.getSubscription()
      if (!subscription) throw new Error('Volvé a activar las notificaciones de este dispositivo.')
      await post({ action: 'test', endpoint: subscription.endpoint })
      if (alive.current) setMessage('Prueba enviada. Revisá las notificaciones del dispositivo.')
    } catch (error) { if (alive.current) setMessage(error.message) }
    finally { if (operation.current === token) operation.current = null; if (alive.current) setBusy(false) }
  }
  return { enabled, busy, message, activate, deactivate, test, supported, needsHome, available: Boolean(config.current && registration.current) }
}
