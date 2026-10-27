import React from 'react'
export default function WebPushControls({ push }) {
  return <details className="notification-device-settings">
    <summary>Notificaciones del dispositivo{push.enabled ? ' · Activas' : ''}</summary>
    <div>
      <p>{push.needsHome ? 'En iPhone o iPad: agregá esta web a la pantalla de inicio desde Safari y abrila desde su icono. Requiere iOS 16.4 o posterior.' : !push.supported ? 'Este navegador no permite notificaciones Web Push. Usá un navegador compatible o la aplicación agregada al inicio.' : 'Recibí avisos aunque la plataforma esté cerrada. El dispositivo controla el sonido y cómo se muestran.'}</p>
      {push.supported && <div className="notification-device-actions"><button type="button" disabled={push.busy || !push.available} onClick={push.enabled ? push.deactivate : push.activate}>{push.busy ? 'Procesando…' : push.enabled ? 'Desactivar en este dispositivo' : 'Activar en este dispositivo'}</button>{push.enabled && <button type="button" disabled={push.busy} onClick={push.test}>Enviar prueba</button>}</div>}
      {push.message && <p role="status">{push.message}</p>}
    </div>
  </details>
}
