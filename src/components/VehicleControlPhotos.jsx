import React, { useEffect, useState } from 'react'
import { requestJson } from '../infrastructure/http/json-request.mjs'

export default function VehicleControlPhotos({ record }) {
  const [opened, setOpened] = useState(false)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const endpoint = `/api/attachments/service/${encodeURIComponent(String(record.id))}`
  useEffect(() => {
    if (!opened) return
    let active = true
    setLoading(true); setError('')
    requestJson(endpoint).then(result => {
      if (active) setFiles((result.attachments || []).filter(file => file.mime?.startsWith('image/')))
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [opened, endpoint, attempt])
  const photos = [
    ...(record.vehiclePhotoUrl ? [{ url: record.vehiclePhotoUrl, name: 'Foto del control' }] : []),
    ...files.map(file => ({ url: `${endpoint}/${encodeURIComponent(file.id)}`, name: file.name }))
  ]
  const date = record.date ? new Date(`${record.date}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin fecha'
  return <details onToggle={event => { if (event.currentTarget.open) setOpened(true) }}>
    <summary>{date} · {record.status || 'Pendiente'}</summary>
    <p>{record.technicalReportedByName || record.technicians?.join(' / ') || 'Sin responsable informado'}{record.vehicleMileage != null && ` · ${Number(record.vehicleMileage).toLocaleString('es-AR')} km`}</p>
    {opened && <div className="vehicle-control-thumbnails">{photos.map(photo => <button type="button" key={photo.url} className={expanded === photo.url ? 'expanded' : ''} aria-expanded={expanded === photo.url} title={expanded === photo.url ? 'Reducir foto' : 'Ampliar foto'} onClick={() => setExpanded(expanded === photo.url ? null : photo.url)}><img loading="lazy" src={photo.url} alt={photo.name} /></button>)}</div>}
    {loading && <p role="status">Cargando fotos…</p>}
    {error && <p role="alert">No se pudieron cargar las fotos. <button type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></p>}
    {opened && !loading && !error && !photos.length && <p>Sin fotos registradas.</p>}
  </details>
}
