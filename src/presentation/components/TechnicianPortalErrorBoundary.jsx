import React from "react";
import Icon from "../../components/ui/Icon.jsx";

export class TechnicianPortalErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, details) {
    console.error('No se pudo mostrar el portal técnico.', error, details)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="login-page"><div className="login-card technician-recovery"><img src="/logo-pignus.png" alt="Pignus" /><p className="eyebrow">RECUPERAR AGENDA</p><h1>No pudimos mostrar tus servicios</h1><p>Actualizá la página para volver a cargar la agenda. Si el problema continúa, cerrá la sesión e ingresá nuevamente.</p><button title="Recargá la página para volver a intentar la conexión; los datos no guardados pueden perderse." className="primary" type="button" onClick={() => window.location.reload()}>Actualizar página</button><button title="Cerrá tu sesión; necesitarás tus credenciales para volver a ingresar." className="secondary" type="button" onClick={this.props.logout}><Icon name="logout" size={16} />Cerrar sesión</button></div></main>
  }
}
