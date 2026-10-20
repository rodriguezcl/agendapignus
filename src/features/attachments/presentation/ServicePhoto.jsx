import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import { servicePhotoUrl } from "../application/service-photo.mjs";
import React, { useState, useEffect } from "react";
import Attachments, { AttachmentDraftField } from "../../../components/Attachments.jsx";
import { servicePhotoRepository } from "../../../infrastructure/repositories/service-photo-repository.mjs";
import { requestJson } from "../../../infrastructure/http/json-request.mjs";

export function ServicePhoto({ record, className = '', showAttachments = true }) {
  const { can } = useActionPermissions()
  const url = can('service.documents.read') ? servicePhotoUrl(record) : ''
  const [visible, setVisible] = useState(Boolean(url))
  useEffect(() => setVisible(Boolean(url)), [url])
  return <>{url && visible && <a className={`service-photo ${className}`.trim()} href={url} target="_blank" rel="noreferrer" title="Abrir foto del servicio"><img src={url} alt={`Foto de referencia de ${record.client || record.service || 'servicio'}`} onError={() => setVisible(false)} /></a>}{showAttachments && <Attachments key={record?.id || record?.historyId} entityId={record?.id || record?.historyId} />}</>
}

export function ServicePhotoField({ record, photoData = '', removed = false, onChange, disabled = false, onPreparing }) {
  const { can, user, granular } = useActionPermissions()
  const recordId = record?.historyId || record?.id
  const [legacyDeleteAllowed, setLegacyDeleteAllowed] = useState(false)
  const mayRead = can('service.documents.read')
  const mayDeleteOwn = can('service.documents.deleteOwn')
  const mayDeleteAny = can('service.documents.deleteAny')
  const photoUrl = servicePhotoUrl(record)
  const mayDelete = granular ? (mayDeleteAny || mayDeleteOwn) && legacyDeleteAllowed : true
  useEffect(() => {
    setLegacyDeleteAllowed(false)
    if (!granular || !mayRead || (!mayDeleteOwn && !mayDeleteAny) || !recordId || !photoUrl) return undefined
    let active = true
    requestJson(`/api/service-photo/${encodeURIComponent(String(recordId))}?metadata=1`)
      .then(metadata => { if (active) setLegacyDeleteAllowed(metadata.canDelete === true) })
      .catch(() => { if (active) setLegacyDeleteAllowed(false) })
    return () => { active = false }
  }, [granular, mayRead, mayDeleteOwn, mayDeleteAny, recordId, photoUrl, user?.id])
  if (!can('service.documents.read')) return null
  if (recordId) return <section className="service-photo-field"><Attachments key={recordId} entityId={recordId} readOnly={disabled} />{servicePhotoUrl(record) && !removed && <><a href={servicePhotoUrl(record)} target="_blank" rel="noreferrer">Ver foto anterior</a>{mayDelete && <button type="button" className="secondary small" title="Quitá la foto anterior al guardar el formulario." disabled={disabled} onClick={() => onChange({ photoData: '', removed: true })}>Quitar foto anterior</button>}</>}</section>
  return <section className="service-photo-field"><b>Fotos y archivos del servicio</b><AttachmentDraftField files={Array.isArray(photoData) ? photoData : []} disabled={disabled} onPreparing={onPreparing} onChange={files => onChange({ photoData: files.length ? files : '', removed: false })} /><small>Los adjuntos se cargarán al guardar el servicio.</small></section>
}

export function ServicePhotoManager({ record, onMetadataChange }) {
  const { can } = useActionPermissions()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const recordId = record?.id || record?.historyId
  const change = async ({ photoData, removed }) => {
    if (!recordId || saving || (photoData && !can('service.documents.upload'))) return
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
