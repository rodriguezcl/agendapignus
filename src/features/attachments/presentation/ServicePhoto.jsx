import { servicePhotoUrl } from "../application/service-photo.mjs";
import React, { useState, useEffect } from "react";
import Attachments, { AttachmentDraftField } from "../../../components/Attachments.jsx";
import { servicePhotoRepository } from "../../../infrastructure/repositories/service-photo-repository.mjs";

export function ServicePhoto({ record, className = '', showAttachments = true }) {
  const url = servicePhotoUrl(record)
  const [visible, setVisible] = useState(Boolean(url))
  useEffect(() => setVisible(Boolean(url)), [url])
  return <>{url && visible && <a className={`service-photo ${className}`.trim()} href={url} target="_blank" rel="noreferrer" title="Abrir foto del servicio"><img src={url} alt={`Foto de referencia de ${record.client || record.service || 'servicio'}`} onError={() => setVisible(false)} /></a>}{showAttachments && <Attachments key={record?.id || record?.historyId} entityId={record?.id || record?.historyId} />}</>
}

export function ServicePhotoField({ record, photoData = '', removed = false, onChange, disabled = false, onPreparing }) {
  const recordId = record?.historyId || record?.id
  if (recordId) return <section className="service-photo-field"><Attachments key={recordId} entityId={recordId} readOnly={disabled} />{servicePhotoUrl(record) && !removed && <><a href={servicePhotoUrl(record)} target="_blank" rel="noreferrer">Ver foto anterior</a><button type="button" className="secondary small" title="Quitá la foto anterior al guardar el formulario." disabled={disabled} onClick={() => onChange({ photoData: '', removed: true })}>Quitar foto anterior</button></>}</section>
  return <section className="service-photo-field"><b>Fotos y archivos del servicio</b><AttachmentDraftField files={Array.isArray(photoData) ? photoData : []} disabled={disabled} onPreparing={onPreparing} onChange={files => onChange({ photoData: files.length ? files : '', removed: false })} /><small>Los adjuntos se cargarán al guardar el servicio.</small></section>
}

export function ServicePhotoManager({ record, onMetadataChange }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const recordId = record?.id || record?.historyId
  const change = async ({ photoData, removed }) => {
    if (!recordId || saving) return
    setSaving(true); setError('')
    try {
      if (photoData) {
        const result = await servicePhotoRepository.upload(recordId, photoData)
        onMetadataChange({ servicePhotoAttached: true, servicePhotoUrl: result.url, servicePhotoAttachedAt: result.createdAt })
      } else if (removed) {
        await servicePhotoRepository.remove(recordId)
        onMetadataChange({ servicePhotoAttached: false, servicePhotoUrl: '', servicePhotoAttachedAt: '' })
      }
    } catch (photoError) { setError(photoError.message) }
    finally { setSaving(false) }
  }
  return <div className="service-photo-manager"><ServicePhotoField record={record} disabled={!recordId || saving} onChange={change} />{!recordId && <small>Guardá el servicio antes de adjuntar una foto.</small>}{error && <small className="field-error" role="alert">{error}</small>}</div>
}
