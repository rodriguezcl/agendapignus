import React from 'react'
import Icon from './Icon.jsx'
import './refresh-button.css'

export default function RefreshButton() {
  return <button type="button" className="refresh-button" aria-label="Actualizar página" title="Actualizá la página sin cerrar sesión." onClick={() => window.dispatchEvent(new Event('pignus:refresh'))}><Icon name="refresh" size={18} /><span>Actualizar</span></button>
}
