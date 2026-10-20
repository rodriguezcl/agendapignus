import React, { useState } from 'react'
import { monthFridays, vehicleLabel } from '../vehicle-controls.mjs'
import { controlFriday } from '../features/state/application/vehicle-responsibility-swap.mjs'
import './vehicle-responsibility-swap.css'

export default function VehicleResponsibilitySwap({ month, today, vehicles, history, disabled, onSave, onBusyChange }) {
  const fridays = monthFridays(month).filter(day => day >= today)
  const [friday, setFriday] = useState(fridays[0] || '')
  const [first, setFirst] = useState(String(vehicles[0]?.id || ''))
  const [second, setSecond] = useState(String(vehicles[1]?.id || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const records = [first, second].map(id => history.find(record => record.vehicleControl && String(record.vehicleId) === id && controlFriday(record) === friday))
  const save = async () => {
    if (busy) return
    setBusy(true); onBusyChange(true); setError('')
    try { await onSave({ friday, vehicleIds: [first, second], baseRecords: records.filter(Boolean) }) }
    catch (failure) { setError(failure.message || 'No se pudo guardar el intercambio.') }
    finally { setBusy(false); onBusyChange(false) }
  }
  if (!fridays.length || vehicles.length < 2) return null
  return <details className="vehicle-responsibility-swap"><summary>Intercambiar responsables esta semana</summary>
    <p>Elegí el viernes y los dos vehículos. Se intercambian sus responsables sólo para ese control; la asignación mensual se conserva.</p>
    {disabled && <p>Guardá los cambios mensuales antes de realizar un intercambio.</p>}
    <fieldset disabled={disabled || busy}>
      <label>Viernes del control<select value={friday} onChange={event => { setFriday(event.target.value); setError('') }}>{fridays.map(day => <option key={day} value={day}>{day.split('-').reverse().join('/')}</option>)}</select></label>
      <div className="vehicle-swap-pair">{[[first, setFirst, 'Primer vehículo'], [second, setSecond, 'Segundo vehículo']].map(([value, setter, label]) => <label key={label}>{label}<select value={value} onChange={event => { setter(event.target.value); setError('') }}>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}</select></label>)}</div>
      {first !== second && records.every(Boolean) && <p className="vehicle-swap-preview">{records.map((record, index) => <span key={record.id}><b>{vehicleLabel(vehicles.find(vehicle => String(vehicle.id) === String(record.vehicleId)))}</b>: {record.technicians?.[0] || 'Sin responsable'} → <strong>{records[1 - index].technicians?.[0] || 'Sin responsable'}</strong></span>)}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <button title="Confirmá el intercambio de responsables para el viernes seleccionado." type="button" className="primary" disabled={!friday || first === second} onClick={save}>{busy ? 'Guardando intercambio…' : 'Confirmar intercambio'}</button>
    </fieldset>
  </details>
}
