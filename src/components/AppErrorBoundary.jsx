import React from 'react'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false, closing: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, details) {
    console.error('No se pudo mostrar Agenda técnica.', error, details)
  }

  closeSession = async () => {
    this.setState({ closing: true })
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // La recarga posterior también permite recuperar una sesión ya vencida.
    } finally {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="login-page"><div className="login-card app-recovery"><img src="/logo-pignus.png" alt="Pignus" /><p className="eyebrow">RECUPERAR AGENDA</p><h1>No pudimos mostrar esta pantalla</h1><p>Actualizá la página para volver a cargar la información. Si el problema continúa, cerrá la sesión e ingresá nuevamente.</p><button className="primary" type="button" onClick={() => window.location.reload()}>Actualizar página</button><button className="secondary" type="button" disabled={this.state.closing} onClick={this.closeSession}>{this.state.closing ? 'Cerrando sesión…' : 'Cerrar sesión'}</button></div></main>
  }
}
