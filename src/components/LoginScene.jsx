import React, { useState } from 'react'
import Icon from './ui/Icon.jsx'
import './login-scene.css'

export default function LoginScene({ children }) {
  const [paused, setPaused] = useState(false)

  return <main className="login-page login-page--precision">
    <div className="login-precision-art" data-paused={paused} aria-hidden="true">
      <svg viewBox="0 0 1600 960" preserveAspectRatio="xMidYMid slice" focusable="false">
        <path className="login-precision-grid" d="M0 240H400V0M0 720H240V960M1360 0V200H1600M1260 960V760H1600M80 0V960M1520 0V960" />
        <path className="login-precision-trace" d="M-40 410H140L220 330H360V160H530M-30 580H220V680L320 780H490V1000M1050-40V130H1220L1360 270H1640M1090 1000V780L1220 650H1430V480H1650" />
        <path className="login-precision-trace" d="M0 120H220V210H310M0 850H130V730M1600 390H1460V330M1600 860H1410V810H1340" />
        <path className="login-precision-signal" d="M-40 410H140L220 330H360V160H530" />
        <path className="login-precision-signal login-precision-signal--second" d="M1090 1000V780L1220 650H1430V480H1650" />
        <g className="login-precision-node">
          <circle cx="140" cy="410" r="4" /><circle cx="360" cy="160" r="4" />
          <circle cx="220" cy="680" r="4" /><circle cx="490" cy="780" r="4" />
          <circle cx="1220" cy="130" r="4" /><circle cx="1430" cy="650" r="4" />
          <circle cx="1090" cy="780" r="4" />
        </g>
      </svg>
    </div>
    <div className="login-panel">
      {children}
      <p className="login-version">v2.0 · Agenda técnica</p>
    </div>
    <button
      type="button"
      className="login-motion-control"
      aria-pressed={paused}
      title={paused ? 'Reanudá la animación del fondo.' : 'Pausá la animación del fondo.'}
      onClick={() => setPaused(value => !value)}
    >
      <Icon name={paused ? 'play' : 'pause'} size={14} />
      {paused ? 'Reanudar fondo' : 'Pausar fondo'}
    </button>
  </main>
}
