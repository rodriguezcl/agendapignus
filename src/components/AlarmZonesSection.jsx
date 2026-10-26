import React, { useEffect, useRef, useState } from 'react'
import { usePermissions } from '../presentation/contexts/permissions-context.jsx'
import { requestJson } from '../infrastructure/http/json-request.mjs'
import './alarm-zones.css'

const dateTime = value => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
export function AlarmZoneReport({ report }) {
  return <div className="alarm-zone-report"><p>Informadas por <strong>{report.reportedByName}</strong> · {dateTime(report.reportedAt)}{!report.complete && ' · Avance de instalación'}</p><div className="alarm-zone-list">{report.zones.map(zone => <article key={zone.number}><header><strong>Zona {String(zone.number).padStart(2,'0')}</strong><b>{zone.name || 'Nombre pendiente'}</b></header><dl><div><dt>Atributo</dt><dd>{zone.attribute || 'Pendiente'}</dd></div><div><dt>Sensor</dt><dd>{zone.sensor === 'Otro' ? zone.sensorOther || 'Otro sin especificar' : zone.sensor || 'Pendiente'}</dd></div></dl></article>)}</div></div>
}

export default function AlarmZonesSection({ customerId, recordId, onBusyChange, onResolved }) {
  const { can } = usePermissions()
  const [reports, setReports] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false), [verified, setVerified] = useState({})
  const saving = useRef(false)
  const allowed = can('service.documents.read') && (recordId || can('accounts.view'))
  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true); setError(''); setReports([]); setVerified({})
    requestJson('/api/customers/alarm-zones?' + new URLSearchParams(recordId ? { recordId } : { customerId }))
      .then(data => { if (active) setReports(data.reports || []) }).catch(failure => { if (active) setError(failure.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [customerId, recordId, allowed, retry])
  if (!allowed) return null
  const confirm = async item => {
    if (saving.current || !verified[item.recordId]) return
    saving.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      const result = await requestJson('/api/customers/alarm-zones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId: item.recordId, reportedAt: item.report.reportedAt }) })
      setReports(current => current.map(row => row.recordId === item.recordId ? result.report : row))
      await globalThis.__pignusRefreshRemoteState?.()
      onResolved?.()
    } catch (failure) { setError(failure.message || 'No se pudo confirmar la carga. Reintentá.') }
    finally { saving.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const render = item => <div key={item.recordId} className="alarm-zone-saved">
    <p><strong>{item.client}</strong> · Servicio del {item.date?.split('-').reverse().join('/')}</p>
    <AlarmZoneReport report={item.report} />
    {item.report.softguard?.completedAt ? <p className="alarm-zone-status">Carga en SoftGuard confirmada por {item.report.softguard.completedByName} · {dateTime(item.report.softguard.completedAt)}</p> : <div className="alarm-zone-management"><strong>Pendiente de cargar en SoftGuard</strong><p>Estos datos fueron informados por el técnico. La carga en SoftGuard se realiza manualmente.</p>{can('customers.softguard.resolve') && <><label className="alarm-zone-verify"><input type="checkbox" checked={Boolean(verified[item.recordId])} disabled={busy} onChange={event => setVerified({ ...verified, [item.recordId]: event.target.checked })} /><span>Verifiqué que estas zonas ya están cargadas en SoftGuard.</span></label><button type="button" className="primary" disabled={busy || !verified[item.recordId]} onClick={() => confirm(item)}>{busy ? 'Guardando…' : 'Confirmar zonas cargadas'}</button></>}</div>}
  </div>
  return <section className="alarm-zones-section" aria-label="Zonas de la alarma" aria-busy={busy || loading || undefined}>
    <h3>Zonas de la alarma</h3>
    {loading && <p role="status">Consultando zonas…</p>}
    {error && <p role="alert">{error} <button type="button" className="secondary" disabled={busy} onClick={() => setRetry(value => value+1)}>Actualizar zonas</button></p>}
    {!loading && !error && !reports.length && <p>Todavía no hay zonas informadas digitalmente para esta cuenta.</p>}
    {reports[0] && <><p>Último informe de instalación registrado.</p>{render(reports[0])}</>}
    {reports.length > 1 && <details><summary>Informes anteriores ({reports.length-1})</summary>{reports.slice(1).map(render)}</details>}
  </section>
}
