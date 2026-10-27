import React, { useEffect, useId, useRef, useState } from 'react'
import Icon from './ui/Icon.jsx'
import useNotificationSound from './useNotificationSound.js'
import WebPushControls from './WebPushControls.jsx'
import { pendingPush, clearPendingPush } from '../infrastructure/browser/push-navigation.mjs'
import './notification-center.css'
import { notificationAppearance, notificationColorStyle } from './notification-appearance.mjs'

/** Active operational notices; opening one never marks its cause as resolved. */
export default function NotificationCenter({ notifications = [], onSelect, userKey, readySources }) {
  const sound = useNotificationSound({ notifications, userKey, readySources })
  const [open, setOpen] = useState(false)
  const [pushRequest, setPushRequest] = useState(pendingPush)
  const [pushMessage, setPushMessage] = useState('')
  const pushOpenedAt = useRef(Date.now())
  const root = useRef(null)
  const toggle = useRef(null)
  const panel = useRef(null)
  const id = useId()
  const count = notifications.length
  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) toggle.current?.focus()
  }

  useEffect(() => {
    const receive = event => { pushOpenedAt.current = Date.now(); setPushMessage(''); setPushRequest(event.detail); setOpen(true) }
    window.addEventListener('pignus-push-open', receive)
    return () => window.removeEventListener('pignus-push-open', receive)
  }, [])
  useEffect(() => {
    if (!pushRequest) return
    if (pushRequest.userId !== String(userKey)) {
      setPushMessage('Este aviso pertenece a otra cuenta. Ingresá con la cuenta que lo recibió.'); setOpen(true); setPushRequest(null); clearPendingPush(); return
    }
    const notice = notifications.find(item => item.id === pushRequest.noticeId)
    if (notice) { setPushRequest(null); clearPendingPush(); onSelect?.(notice); return }
    if (!pushRequest.noticeId) { setOpen(true); setPushRequest(null); clearPendingPush(); return }
    setOpen(true)
    const timer = setTimeout(() => { setPushMessage('El aviso ya no está pendiente o no está disponible para tu cuenta.'); setPushRequest(null); clearPendingPush() }, Math.max(0, 15000 - (Date.now() - pushOpenedAt.current)))
    return () => clearTimeout(timer)
  }, [pushRequest, notifications, userKey, onSelect])

  useEffect(() => {
    if (!open) return undefined
    const focusFrame = requestAnimationFrame(() => panel.current?.querySelector('.notification-item, .notification-close')?.focus())
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    const keyboard = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        toggle.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [open])

  const activate = notification => {
    close()
    onSelect?.(notification)
  }

  return <div className="notification-center" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button type="button" className="notification-toggle topbar-icon-button" ref={toggle}
      title={count ? `${count} aviso${count === 1 ? '' : 's'} activo${count === 1 ? '' : 's'}` : 'No hay avisos activos'}
      aria-label={`Notificaciones: ${count} aviso${count === 1 ? '' : 's'} activo${count === 1 ? '' : 's'}`}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {count > 0 && <span className="notification-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
    {open && <section className="notification-panel" id={id} ref={panel} role="dialog" aria-label="Notificaciones">
      <header className="notification-header">
        <div className="notification-heading"><h2>Notificaciones</h2><p>{count} aviso{count === 1 ? '' : 's'} activo{count === 1 ? '' : 's'}</p></div>
        <div className="notification-header-actions">
          <button type="button" className="notification-sound-toggle" aria-label={sound.enabled ? 'Silenciar' : 'Activar sonido'} title={sound.enabled ? 'Sonido activado. Silenciar nuevos avisos.' : 'Activar sonido para nuevos avisos en este navegador.'} aria-pressed={sound.enabled} onClick={sound.toggle}><Icon name={sound.enabled ? 'volume' : 'muted'} size={18} /></button>
          <button type="button" aria-label="Probar sonido" title="Probar sonido" disabled={!sound.enabled} onClick={sound.test}><Icon name="play" size={18} /></button>
          <button type="button" className="notification-close" aria-label="Cerrar notificaciones" title="Cerrar notificaciones" onClick={() => close(true)}><Icon name="close" size={18} /></button>
        </div>
      </header>
      {sound.message && <p className="notification-sound-message" role="status">{sound.message}</p>}
      {pushMessage && <p className="notification-sound-message" role="status">{pushMessage}</p>}
      <div className="notification-list">
        {count ? notifications.map(notification => {
          const appearance = notificationAppearance(notification)
          return <button type="button" key={notification.id} className="notification-item" data-category={appearance.category} style={notificationColorStyle(appearance)} data-tone={notification.tone || 'info'} title={`${appearance.label} · Abrir: ${notification.title}`} onClick={() => activate(notification)}>
          <span className="notification-marker" aria-hidden="true"><Icon name={appearance.icon} size={18} /></span>
          <span className="notification-copy"><strong>{notification.title}</strong><span>{notification.detail}</span></span>
        </button>}) : <div className="notification-empty"><Icon name="check" size={24} /><strong>No hay avisos activos</strong><p>Acá aparecerán los avisos que requieran seguimiento.</p></div>}
      </div>
      <footer className="notification-footer"><WebPushControls key={userKey} userKey={userKey} /><small>Las novedades de Tickets se marcan como leídas al abrir el caso. Los pendientes se mantienen hasta su resolución.</small></footer>
    </section>}
  </div>
}
