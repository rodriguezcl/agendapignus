import { useActionPermissions } from '../presentation/hooks/useActionPermissions.mjs'
import React, { useEffect, useRef, useState } from 'react'
import Icon from './ui/Icon.jsx'
import { fetchPdf } from '../infrastructure/browser/fetch-pdf.mjs'
import { triggerBrowserDownload } from '../infrastructure/browser/browser-download.mjs'
import './vehicle-insurance-download.css'

export default function VehicleInsuranceDownload({ vehicle, className = '' }) {
  const { can } = useActionPermissions()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(null)
  useEffect(() => () => { pending.current?.abort(); pending.current = null }, [vehicle.id])
  const download = async () => {
    if (!can('vehicle.insurance.read') || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setLoading(true); setError('')
    try {
      const blob = await fetchPdf(`/api/vehicle-insurance/${encodeURIComponent(String(vehicle.id))}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      const href = URL.createObjectURL(blob)
      try { triggerBrowserDownload(href, vehicle.insuranceFileName || `seguro-${vehicle.plate || vehicle.id}.pdf`) }
      finally { setTimeout(() => URL.revokeObjectURL(href), 60_000) }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || 'No se pudo descargar el seguro. Volvé a intentarlo.')
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false) }
    }
  }
  if (!can('vehicle.insurance.read')) return null
  return <span className="vehicle-insurance-download-control">
    <button type="button" className={`vehicle-insurance-download ${className}`} title="Descargá el PDF del seguro de este vehículo." disabled={loading} aria-busy={loading} onClick={download}><Icon name="download" size={16} />{loading ? 'Descargando…' : 'Descargar PDF'}</button>
    {loading && <span className="vehicle-download-status" role="status">Preparando el PDF del seguro…</span>}
    {error && <span className="vehicle-download-error" role="alert">{error}<button type="button" className="secondary small" title="Volvé a solicitar el PDF del seguro de este vehículo." onClick={download}>Reintentar descarga</button></span>}
  </span>
}
