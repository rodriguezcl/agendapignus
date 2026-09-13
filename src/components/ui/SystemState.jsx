import React from 'react'
import Icon from './Icon.jsx'

const stateIcons = {
  empty: 'search',
  error: 'alert',
  offline: 'alert',
  success: 'check',
  warning: 'alert'
}

export default function SystemState({ type = 'empty', title, detail, action, actionLabel = 'Reintentar', compact = false, inverse = false }) {
  const busy = type === 'loading' || type === 'syncing'
  const urgent = type === 'error' || type === 'offline'
  return <section className={`system-state is-${type} ${compact ? 'is-compact' : ''} ${inverse ? 'is-inverse' : ''}`} role={urgent ? 'alert' : 'status'} aria-live={urgent ? 'assertive' : 'polite'} aria-busy={busy || undefined}>
    {busy ? <div className="system-state-skeleton" aria-hidden="true"><i /><i /><i /></div> : <span className="system-state-icon" aria-hidden="true"><Icon name={stateIcons[type] || 'settings'} size={22} /></span>}
    <div className="system-state-copy"><h3>{title}</h3>{detail && <p>{detail}</p>}</div>
    {action && <button type="button" className="secondary" onClick={action}>{actionLabel}</button>}
  </section>
}
