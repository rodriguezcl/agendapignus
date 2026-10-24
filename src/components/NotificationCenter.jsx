import React, { useEffect, useId, useRef, useState } from 'react'
import Icon from './ui/Icon.jsx'
import useNotificationSound from './useNotificationSound.js'
import './notification-center.css'

/** Active operational notices; opening one never marks its cause as resolved. */
export default function NotificationCenter({ notifications = [], onSelect, userKey, readySources }) {
  const sound = useNotificationSound({ notifications, userKey, readySources })
  const [open, setOpen] = useState(false)
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
      <header className="notification-header"><div><h2>Notificaciones</h2><p>{count} aviso{count === 1 ? '' : 's'} activo{count === 1 ? '' : 's'}</p></div><button type="button" className="notification-close" aria-label="Cerrar notificaciones" title="Cerrá las notificaciones y volvé a la pantalla actual." onClick={() => close(true)}><Icon name="close" size={17} /></button></header>
      <div className="notification-sound-controls"><button type="button" className="notification-sound-toggle" aria-pressed={sound.enabled} onClick={sound.toggle}><Icon name={sound.enabled ? 'volume' : 'muted'} size={17} />{sound.enabled ? 'Silenciar' : 'Activar sonido'}</button><button type="button" disabled={!sound.enabled} onClick={sound.test}>Probar sonido</button><small>Sonido breve para nuevos avisos. Preferencia guardada en este navegador.</small>{sound.message && <small role="status">{sound.message}</small>}</div>
      <div className="notification-list">
        {count ? notifications.map(notification => <button type="button" key={notification.id} className="notification-item" data-tone={notification.tone || 'info'} title={`Abrir: ${notification.title}`} onClick={() => activate(notification)}>
          <span className="notification-marker" aria-hidden="true"><Icon name={notification.target?.type === 'collection' ? 'wallet' : notification.tone === 'danger' ? 'alert' : 'calendar'} size={17} /></span>
          <span className="notification-copy"><strong>{notification.title}</strong><span>{notification.detail}</span></span>
        </button>) : <div className="notification-empty"><Icon name="check" size={24} /><strong>No hay avisos activos</strong><p>Acá aparecerán los avisos que requieran seguimiento.</p></div>}
      </div>
      <footer className="notification-footer"><small>Las novedades de Tickets se marcan como leídas al abrir el caso. Los pendientes se mantienen hasta su resolución.</small></footer>
    </section>}
  </div>
}
