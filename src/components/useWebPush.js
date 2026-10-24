import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../infrastructure/http/json-request.mjs'

const endpoint = '/api/push/subscription'
const post = input => requestJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
const decodeKey = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0))
export default function useWebPush(userKey) {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(true), [message, setMessage] = useState('')
  const config = useRef(null), registration = useRef(null), alive = useRef(false)
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const needsHome = ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches
  const supported = !needsHome && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  useEffect(() => {
    alive.current = true
    let canceled = false
    if (!supported) { setBusy(false); return () => { alive.current = false } }
    const init = async () => {
      try {
        const settings = await requestJson(endpoint)
        if (canceled) return
        if (!settings.available) { setMessage('Las notificaciones del dispositivo todavía no están disponibles.'); return }
        config.current = settings
        const worker = await navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' })
        await navigator.serviceWorker.ready
        if (canceled) return
        registration.current = worker
        const subscription = await worker.pushManager.getSubscription()
        if (subscription && Notification.permission === 'granted') {
          const state = await post({ action: 'status', endpoint: subscription.endpoint })
          if (!canceled) setEnabled(state.enabled === true)
        }
      } catch { if (!canceled) setMessage('No se pudo consultar el dispositivo. Cerrá y volvé a abrir la plataforma para reintentar.') }
      finally { if (!canceled) setBusy(false) }
    }
    void init()
    return () => { canceled = true; alive.current = false }
  }, [userKey, supported])
  const activate = async () => {
    if (busy || !registration.current || !config.current) return
    setBusy(true); setMessage('')
    try {
      // This must happen directly in the click handler, especially on iOS.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Las notificaciones están bloqueadas. Permitilas en los ajustes de notificaciones de este sitio o aplicación.' : 'No se activaron las notificaciones. Podés volver a intentarlo.')
      const subscription = await registration.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.current.publicKey) })
      if (!alive.current) return
      await post({ action: 'subscribe', subscription: subscription.toJSON() })
      if (alive.current) { setEnabled(true); setMessage('Activadas para este usuario en este dispositivo. Podés enviar una prueba.') }
    } catch (error) { if (alive.current) setMessage(error.message || 'No se pudieron activar las notificaciones.') }
    finally { if (alive.current) setBusy(false) }
  }
  const deactivate = async () => {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const subscription = await registration.current?.pushManager.getSubscription()
      if (subscription) {
        await requestJson(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) })
        await subscription.unsubscribe()
      }
      if (alive.current) { setEnabled(false); setMessage('Notificaciones desactivadas en este dispositivo.') }
    } catch (error) { if (alive.current) setMessage(error.message) }
    finally { if (alive.current) setBusy(false) }
  }
  const test = async () => {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const subscription = await registration.current?.pushManager.getSubscription()
      if (!subscription) throw new Error('Volvé a activar las notificaciones de este dispositivo.')
      await post({ action: 'test', endpoint: subscription.endpoint })
      if (alive.current) setMessage('Prueba enviada. Revisá las notificaciones del dispositivo.')
    } catch (error) { if (alive.current) setMessage(error.message) }
    finally { if (alive.current) setBusy(false) }
  }
  return { enabled, busy, message, activate, deactivate, test, supported, needsHome, available: Boolean(config.current && registration.current) }
}
