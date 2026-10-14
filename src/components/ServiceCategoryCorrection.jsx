import React, { useState } from 'react'
import EditorModal from './ui/EditorModal.jsx'
import ServiceTypesField from './ServiceTypesField.jsx'
import { selectedServiceIds, serviceTypesLabel } from '../domain/services/multi-service.mjs'
import './service-category-correction.css'

export default function ServiceCategoryCorrection({ record, services, onSave, close }) {
  const [draft, setDraft] = useState(record)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ids = selectedServiceIds(draft)
  const changed = JSON.stringify([...ids].sort()) !== JSON.stringify([...selectedServiceIds(record)].sort())
  const submit = async event => {
    event.preventDefault()
    if (busy || !changed || !ids.length || !reason.trim()) return
    setBusy(true); setError('')
    try { await onSave({ serviceIds: ids, reason: reason.trim() }); close() }
    catch (failure) { setError(failure.message || 'No se pudo guardar la corrección.') }
    finally { setBusy(false) }
  }
  return <EditorModal active title="Corregir categoría" eyebrow="SERVICIO COMPLETADO" busy={busy} dirty={changed || Boolean(reason)} onClose={close}>
    {({ requestClose }) => <form className="category-correction-form" onSubmit={submit}>
      <p><b>{record.client}</b><br />Categoría registrada: {serviceTypesLabel(record)}</p>
      <p>Se conserva la finalización y el informe técnico. La corrección actualiza los indicadores; si se quita un retiro erróneo, se restituye el abonado cuando no existe otra baja completada.</p>
      <fieldset disabled={busy}>
        <ServiceTypesField task={draft} services={services} onChange={patch => setDraft(previous => ({ ...previous, ...patch }))} />
        <label>Motivo de la corrección<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Por ejemplo: mudanza; el abonado mantiene el servicio." /></label>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={requestClose}>Cancelar</button><button type="submit" className="primary" disabled={busy || !changed || !ids.length || !reason.trim()}>{busy ? 'Guardando…' : 'Guardar corrección'}</button></div>
    </form>}
  </EditorModal>
}
