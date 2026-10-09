import React, { useContext, useState } from 'react'
import { FrozenMonthsContext } from './FrozenMonths.jsx'
import { isResidentialInstallation, recordBelongsToCustomer, subscriptionCorrectionBase } from '../domain/customers/subscription-correction.mjs'
import './customer-subscription-correction.css'

const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : value

export function CustomerSubscriptionCorrection({ customer, history, services, onSave, onBusyChange }) {
  const options = useContext(FrozenMonthsContext)
  const [selection, setSelection] = useState(null)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const records = history.filter(record => recordBelongsToCustomer(record, customer) && isResidentialInstallation(record, services))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)))
  if (!records.length) return null
  const select = record => {
    setSelection(record); setMessage(''); setError('')
    setDraft({ monthlyFee: record.monthlyFee ?? '', monthlyFeeEffectiveFrom: record.monthlyFeeEffectiveFrom || '', freezeMonthlyFee: record.freezeMonthlyFee ?? '', frozenMonths: record.frozenMonths || '' })
  }
  const save = async event => {
    event.preventDefault()
    if (typeof draft.freezeMonthlyFee !== 'boolean') { setError('Indicá si se otorgaron meses congelados.'); return }
    setBusy(true); onBusyChange?.(true); setError('')
    try {
      await onSave({ customerId: customer.customerId, recordId: selection.id, base: subscriptionCorrectionBase(selection), values: { ...draft, frozenMonths: draft.freezeMonthlyFee ? Number(draft.frozenMonths) : 0 } })
      setSelection(null); setMessage('Datos del abono guardados. Los reportes del mes de la instalación ya utilizan esta corrección.')
    } catch (failure) { setError(failure.message || 'No se pudo guardar la corrección.') }
    finally { setBusy(false); onBusyChange?.(false) }
  }
  return <section className="customer-subscription-correction" aria-label="Corrección de datos del abono">
    {!selection ? <button title="Corregí el abono mensual del servicio seleccionado." type="button" className="secondary" onClick={() => select(records[0])}>Corregir datos del abono</button> : <form onSubmit={save}>
      <h3>Corregir datos del abono</h3>
      <p>Elegí la instalación que querés subsanar. Se actualizarán sus reportes Excel/PDF; la agenda seguirá cerrada. Esta opción no registra un aumento de abono actual.</p>
      <fieldset disabled={busy}>
        <label>Instalación a corregir<select value={selection.id} onChange={event => select(records.find(record => String(record.id) === event.target.value))}>
          {records.map(record => <option key={record.id} value={record.id}>{dateLabel(record.date)} · {record.time || 'Sin hora'} · {record.service} · {record.id}</option>)}
        </select></label>
        <div className="subscription-correction-fields">
          <label>Monto de abono mensual ($)<input required type="number" min="0" max="999999999.99" step="0.01" inputMode="decimal" value={draft.monthlyFee} onChange={event => setDraft({ ...draft, monthlyFee: event.target.value })} /></label>
          <label>Vigente desde<input required type="date" value={draft.monthlyFeeEffectiveFrom} onChange={event => setDraft({ ...draft, monthlyFeeEffectiveFrom: event.target.value })} /></label>
          <label>Meses congelados<select required value={draft.freezeMonthlyFee === '' ? '' : draft.freezeMonthlyFee ? 'yes' : 'no'} onChange={event => setDraft({ ...draft, freezeMonthlyFee: event.target.value === '' ? '' : event.target.value === 'yes', frozenMonths: '' })}>
            <option value="">Seleccionar</option><option value="no">No</option><option value="yes" disabled={!options.length && !selection.freezeMonthlyFee}>Sí</option>
          </select></label>
          {draft.freezeMonthlyFee === true && <label>Cantidad de meses<select required value={draft.frozenMonths} onChange={event => setDraft({ ...draft, frozenMonths: Number(event.target.value) })}>
            <option value="">Seleccionar</option>
            {selection.freezeMonthlyFee && Number(selection.frozenMonths) > 0 && !options.includes(Number(selection.frozenMonths)) && <option value={selection.frozenMonths}>{selection.frozenMonths} meses (selección anterior)</option>}
            {options.map(months => <option key={months} value={months}>{months} meses</option>)}
          </select></label>}
        </div>
        {selection.subscriptionCorrectedAt && <p>Última corrección: {selection.subscriptionCorrectedBy?.name || 'Usuario'} · {new Date(selection.subscriptionCorrectedAt).toLocaleString('es-AR')}</p>}
        <div className="action-group"><button title="Cancelá la corrección del abono sin guardar cambios." type="button" className="secondary" onClick={() => { setSelection(null); setError('') }}>Cancelar</button><button title="Guardá la corrección del abono mensual de este servicio." type="submit" className="primary">{busy ? 'Guardando…' : 'Guardar corrección'}</button></div>
      </fieldset>
    </form>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>
}
