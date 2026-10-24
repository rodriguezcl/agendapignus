import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../../components/ui/Icon.jsx'
import { requestJson } from '../../../infrastructure/http/json-request.mjs'
import './customer-sync.css'

const date = value => value ? new Date(value).toLocaleString('es-AR') : 'Todavía sin registro'
const labels = { pending: 'Pendiente', running: 'Sincronizando', completed: 'Completada', error: 'Error' }
const errors = {
  WORKER_TIMEOUT: 'La PC no confirmó el resultado. Revisá el conector antes de volver a intentar.',
  REQUEST_EXPIRED: 'La PC no atendió la solicitud en una hora.',
  IMPORT_UNCERTAIN: 'Hay un intento del conector anterior sin comprobante verificable. Requiere revisar su resultado antes de repetirlo.',
  IMPORT_RETRY: 'El servidor confirmó que el intento no se guardó. El conector volverá a intentarlo automáticamente con datos actualizados.',
  RECOVERY_UNAVAILABLE: 'No se pudo verificar el resultado con el servidor. El conector lo consultará nuevamente sin duplicar la importación.',
  RECOVERY_UPDATE_REQUIRED: 'Esta versión del conector requiere publicar la actualización de Agentec.',
  WORKER_INTERRUPTED: 'Se interrumpió el conector. En el próximo intento verificará el comprobante antes de importar.',
  AUTH_REJECTED: 'Revisá los accesos del conector.',
  DOWNLOAD_TIMEOUT: 'SoftGuard no completó la descarga.',
  LOCKED: 'Ya había otra ejecución en esa PC.'
}
export default function CustomerSync({ administrator, onComplete }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const completed = useRef(null)
  const callback = useRef(onComplete)
  callback.current = onComplete
  useEffect(() => {
    let stopped = false, timer
    const poll = async () => {
      try {
        const next = await requestJson('/api/customers/sync', { cache: 'no-store' })
        if (stopped) return
        setStatus(next); setError('')
        const last = next.lastSuccess?.at
        if (completed.current !== null && last && completed.current !== last) Promise.resolve(callback.current?.()).catch(() => {})
        completed.current = last || 0
      } catch (e) { if (!stopped) setError(e.message) }
      finally { if (!stopped) timer = setTimeout(poll, 10000) }
    }
    poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [])
  const execute = async (url, pairing = false) => {
    setBusy(true); setError('')
    try {
      const result = await requestJson(url, { method: 'POST' })
      if (pairing) setToken(result.token)
      else setStatus(result)
    } catch (e) { setError(e.message); setOpen(true) }
    finally { setBusy(false) }
  }
  const active = ['pending', 'running'].includes(status?.job?.status)
  const needsAttention = Boolean(error || status?.job?.status === 'error')
  const connection = !status ? 'Consultando conexión' : !status.configured ? 'PC pendiente de vincular' : status.online ? 'PC conectada' : 'PC sin conexión reciente'
  const close = () => { setOpen(false); setToken('') }
  useEffect(() => {
    if (!open) return
    const escape = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close() } }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [open])
  return <div className="customer-sync-control">
    <button className="secondary" title="Solicitá a la PC conectada que actualice los abonados desde SoftGuard." disabled={busy || !status?.configured || active} onClick={() => execute('/api/customers/sync')}><Icon name="refresh" />{active ? labels[status.job.status] : 'Sincronizar abonados'}</button>
    <button className={`secondary customer-sync-status${needsAttention ? ' customer-sync-status-alert' : ''}`} type="button" aria-label={needsAttention ? 'Estado de sincronización: requiere atención' : 'Estado de sincronización'} aria-haspopup="dialog" title={`${needsAttention ? 'Requiere atención. ' : ''}${connection}. Última sincronización correcta: ${date(status?.lastSuccess?.at)}`} onClick={() => setOpen(true)}><Icon name={needsAttention ? 'alert' : 'clock'} />Estado</button>
    {open && createPortal(<div className="modal-layer" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="modal customer-sync-modal" role="dialog" aria-modal="true" aria-label="Sincronización de abonados">
      <button className="close-modal" aria-label="Cerrar" onClick={close}><Icon name="close" /></button>
      <h2>Sincronización de abonados</h2>
      <p>{connection}</p><p>{status?.presenceEnabled ? 'Detección de bajas habilitada: requiere dos reportes completos consecutivos.' : 'Detección de bajas pendiente: necesita reportes completos y consecutivos del conector. Un intento fallido interrumpe esa verificación.'}</p>
      <p>Estado: <strong>{labels[status?.job?.status] || 'Sin solicitudes'}</strong></p>
      <p>Última conexión de la PC: {date(status?.lastSeen)}</p>
      <p>Última sincronización correcta: {date(status?.lastSuccess?.at)}{status?.lastSuccess?.count != null && ` · ${status.lastSuccess.count} cuentas`}</p>
      {status?.job?.status === 'error' && <p role="alert">{errors[status.job.code] || 'El conector informó un error. Revisá el estado en la PC.'} {status.job.code}</p>}
      {status?.job?.status === 'error' && status?.nextAutomaticAt && <p>Próximo intento automático: {date(status.nextAutomaticAt)}.</p>}
      {status?.job?.status === 'pending' && <p>La PC atenderá la solicitud al conectarse. Si no responde en una hora, la solicitud vence.</p>}
      {administrator && <section><h3>Conectar la PC Windows</h3><p>Generá una clave y cargala en la PC con Conectar.ps1. La clave solo permite atender solicitudes y comunicar resultados; la importación conserva sus permisos habituales.</p>
        {status?.configured && !token && <p>Generar otra clave reemplaza el acceso del conector anterior.</p>}
        {!token ? <button className="secondary" disabled={busy || active} onClick={() => execute('/api/customers/sync/token', true)}>Generar clave de conexión</button> : <><label>Clave de conexión (se muestra una sola vez)<input readOnly value={token} autoComplete="off" onFocus={e => e.target.select()} /></label><p>Guardala únicamente en la PC del conector. Al cerrar esta ventana se oculta.</p></>}
      </section>}
      {error && <p role="alert">{error}</p>}
    </div></div>, document.body)}
  </div>
}
