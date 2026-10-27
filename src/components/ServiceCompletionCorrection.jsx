import React, { useState } from 'react'
import EditorModal from './ui/EditorModal.jsx'
import AlarmZonesEditor from './AlarmZonesEditor.jsx'
import zonesModel from '../../api/_lib/alarm-zones.cjs'
import { serviceTypesFor } from '../domain/services/multi-service.mjs'
import './service-category-correction.css'

export default function ServiceCompletionCorrection({ record: currentRecord, onSave, close, onSaved = close }) {
  const [record] = useState(currentRecord)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState([])
  const [zones, setZones] = useState(() => zonesModel.initialZones(record))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const types = serviceTypesFor(record)
  const installation = zonesModel.installation(record)
  const submit = async event => {
    event.preventDefault()
    if (busy || !reason.trim() || confirmed.length !== types.length) return
    setError('')
    try {
      const alarmZones = installation ? zonesModel.validateZones(zones, true) : undefined
      setBusy(true)
      await onSave({ operation: 'completion-correction', reason: reason.trim(), completedIds: confirmed, ...(installation ? { alarmZones } : {}) }, record)
      onSaved()
    } catch (failure) { setError(failure.message || 'No se pudo guardar la corrección.') }
    finally { setBusy(false) }
  }
  return <EditorModal active title="Corregir resultado" eyebrow="CORRECCIÓN ADMINISTRATIVA" busy={busy} dirty={Boolean(reason || confirmed.length) || JSON.stringify(zones) !== JSON.stringify(zonesModel.initialZones(record))} onClose={close}>
    {({ requestClose }) => <form className="category-correction-form completion-correction-form" onSubmit={submit}>
      <p><b>{record.client}</b></p>
      <p>Usá esta corrección si el trabajo se realizó y el resultado informado fue equivocado. Se conservará el informe anterior con tu nombre y el motivo del cambio.</p>
      <fieldset disabled={busy}>
        <legend>Confirmá los trabajos realizados</legend>
        {types.map(type => <label className="completion-work-check" key={type.id}><input type="checkbox" required checked={confirmed.includes(String(type.id))} onChange={event => setConfirmed(previous => event.target.checked ? [...previous, String(type.id)] : previous.filter(id => id !== String(type.id)))} /><span>{type.name}</span></label>)}
        <label>Motivo de la corrección *<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explicá por qué corresponde dar el servicio por completado." /></label>
      </fieldset>
      {installation && <AlarmZonesEditor value={zones} onChange={setZones} disabled={busy} complete />}
      <p>Esta acción no confirma pagos ni cierra tickets vinculados.</p>
      {record.collectionCancellation?.automatic && <p>El importe anulado automáticamente quedará en revisión en Cobranzas.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={requestClose}>Volver</button><button type="submit" className="primary" disabled={busy || !reason.trim() || confirmed.length !== types.length}>{busy ? 'Guardando…' : 'Confirmar corrección y completar'}</button></div>
    </form>}
  </EditorModal>
}
