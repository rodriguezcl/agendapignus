import { captureCameraPhoto } from '../infrastructure/media/camera-capture.mjs'
import React, { useRef, useState } from 'react'
import { requestJson } from '../infrastructure/http/json-request.mjs'
import { compactVehiclePhoto } from '../infrastructure/media/image-upload.mjs'
import './attachments.css'

const endpoint = (scope, id) => `/api/attachments/${scope}/${encodeURIComponent(String(id))}`
export async function prepareAttachment(file) {
  if (!file) throw new Error('Seleccioná un archivo.')
  let data
  if (file.type.startsWith('image/')) {
    if (file.size > 20_000_000) throw new Error('La imagen original supera los 20 MB.')
    data = await compactVehiclePhoto(file)
  } else {
    if (file.type !== 'application/pdf' || file.size > 3_000_000) throw new Error('Seleccioná una imagen o PDF de hasta 3 MB.')
    data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No se pudo leer el PDF.')); reader.readAsDataURL(file) })
  }
  return { id: crypto.randomUUID(), name: file.name, data }
}
export async function uploadAttachmentBatch(scope, id, files, onSaved = () => {}) {
  for (const file of files) {
    await requestJson(endpoint(scope, id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file) }, `No se pudo cargar ${file.name}.`)
    onSaved(file.id)
  }
}

export function AttachmentDraftField({ files = [], onChange, disabled = false, cameraOnly = false, onPreparing = () => {} }) {
  const gallery = useRef(null), camera = useRef(null), processingRef = useRef(false)
  const [processing, setProcessing] = useState(false), [error, setError] = useState('')
  const select = async (selected, source = 'file') => {
    if (disabled || processingRef.current) return
    processingRef.current = true; setProcessing(true); onPreparing(true); setError('')
    const next = [...files]
    try {
      for (const file of selected) {
        if (next.length >= 20) throw new Error('Se permiten hasta 20 adjuntos por registro.')
        next.push({ ...await prepareAttachment(file), source })
      }
    } catch (e) { setError(e.message) }
    finally { onChange(next); processingRef.current = false; setProcessing(false); onPreparing(false) }
  }
  return <section className="attachment-picker"><p>{cameraOnly ? 'Solo fotos tomadas con la cámara para este control vehicular. Podés sacar fotos sucesivas, hasta 20 adjuntos.' : 'Imágenes y PDF. Podés seleccionar varios archivos o sacar fotos sucesivas. Hasta 20 adjuntos; PDF de hasta 3 MB.'} Las fotos se comprimen automáticamente.</p>
    <div className="attachment-actions">{!cameraOnly && <button title="Seleccioná varias imágenes o archivos PDF para agregar." type="button" className="secondary small" disabled={disabled || processing} onClick={() => gallery.current.click()}>Agregar archivos</button>}<button title="Tomá otra foto sin reemplazar las anteriores." type="button" className="secondary small" disabled={disabled || processing} onClick={async () => { if (!cameraOnly) return camera.current.click(); try { const file = await captureCameraPhoto(); if (file) await select([file], 'camera') } catch (e) { setError(e.message) } }}>Sacar foto</button></div>
    {!cameraOnly && <input ref={gallery} type="file" hidden multiple accept="image/*,application/pdf,.pdf" onChange={e => { const selected = [...e.target.files]; e.target.value = ''; void select(selected) }} />}
    {!cameraOnly && <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={e => { const selected = [...e.target.files]; e.target.value = ''; void select(selected, 'camera') }} />}
    {files.length > 0 && <ul className="attachment-list">{files.map(file => <li key={file.id}>{file.data.startsWith('data:image/') && <img src={file.data} alt={`Vista previa de ${file.name}`} />}<span>{file.name}</span><button title="Quitá este archivo de la selección antes de guardarlo." type="button" disabled={disabled || processing} onClick={() => onChange(files.filter(item => item.id !== file.id))}>Quitar</button></li>)}</ul>}
    {processing && <p role="status">Preparando archivos…</p>}{error && <p role="alert" className="field-error">{error}</p>}
  </section>
}

export default function Attachments({ scope = 'service', entityId, readOnly = false }) {
  const [files, setFiles] = useState([]), [pending, setPending] = useState([]), [loaded, setLoaded] = useState(false)
  const [canWrite, setCanWrite] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [cameraOnly, setCameraOnly] = useState(false)
  const [removing, setRemoving] = useState(null)
  const guard = useRef(false)
  const load = async () => {
    const result = await requestJson(endpoint(scope, entityId))
    setFiles(result.attachments); setCanWrite(result.canWrite); setCameraOnly(Boolean(result.cameraOnly)); setLoaded(true)
  }
  const perform = async action => {
    if (guard.current) return
    guard.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { setError(e.message) } finally { guard.current = false; setBusy(false) }
  }
  if (!entityId) return <p>Guardá el registro para agregar adjuntos.</p>
  return <details className="attachments" onToggle={e => { if (e.currentTarget.open && !loaded) void perform(load) }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <summary>Fotos y archivos adjuntos{loaded ? ` (${files.length})` : ''}</summary>
    {loaded && <><button title="Consultá nuevamente los adjuntos de este registro." type="button" className="secondary small" disabled={busy} onClick={() => perform(load)}>Actualizar adjuntos</button><ul className="attachment-list">{files.map(file => <li key={file.id}><a href={`${endpoint(scope, entityId)}/${file.id}`} target="_blank" rel="noreferrer" title={`Abrí ${file.name}`}>{file.mime.startsWith('image/') ? 'Foto · ' : 'PDF · '}{file.name}</a><small>{Math.ceil(file.bytes / 1024)} KB</small>{file.canDelete && !readOnly && <button type="button" title="Solicitá quitar únicamente este adjunto." disabled={busy} onClick={() => setRemoving(file)}>Quitar</button>}</li>)}</ul>{!files.length && <p>No hay adjuntos adicionales.</p>}</>}
    {loaded && canWrite && !readOnly && <><AttachmentDraftField cameraOnly={cameraOnly} files={pending} onChange={setPending} disabled={busy} />{pending.length > 0 && <button title="Guardá los archivos seleccionados; los demás adjuntos se conservan." type="button" className="primary" disabled={busy} onClick={() => perform(async () => {
      await uploadAttachmentBatch(scope, entityId, pending, id => setPending(previous => previous.filter(file => file.id !== id)))
      await load()
    })}>Guardar {pending.length} adjunto(s)</button>}<small>Los adjuntos se guardan con este botón, independientemente del formulario.</small></>}
    {removing && <div role="alertdialog" aria-label="Quitar adjunto"><p>¿Quitar {removing.name}?</p><button title="Cancelá la eliminación y conservá este adjunto." type="button" disabled={busy} onClick={() => setRemoving(null)}>Cancelar</button><button title="Confirmá la eliminación de este adjunto." type="button" disabled={busy} onClick={() => perform(async () => { await requestJson(`${endpoint(scope, entityId)}/${removing.id}`, { method: 'DELETE' }); setRemoving(null); await load() })}>Quitar adjunto</button></div>}
    {busy && <p role="status">Procesando adjuntos…</p>}{error && <p role="alert" className="field-error">{error} <button title="Volvé a consultar los adjuntos." type="button" disabled={busy} onClick={() => perform(load)}>Reintentar</button></p>}
  </details>
}
