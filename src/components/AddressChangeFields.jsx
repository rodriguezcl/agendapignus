import React from 'react'
import addressChange from '../../api/_lib/address-change.cjs'
import RequiredLabel from '../presentation/components/forms/RequiredLabel.jsx'
import './address-change.css'

export default function AddressChangeFields({ record, onChange, disabled = false, readOnly = false }) {
  if (!addressChange.isAddressChange(record)) return null
  return <div className="address-change-fields">
    {readOnly ? <><b>Domicilio nuevo · instalación</b><p>{record.newAddress || 'Sin registrar'}</p></> : <label>
      <RequiredLabel>Domicilio nuevo</RequiredLabel>
      <input required maxLength={1000} disabled={disabled} autoComplete="off" value={record.newAddress || ''} placeholder="Calle, número, barrio y localidad" onChange={event => onChange(event.target.value)} />
    </label>}
    <small>Retiro en el domicilio actual e instalación en el nuevo. Se conserva la misma cuenta. Administración debe actualizar SoftGuard; la sincronización verificará el cambio al completar el servicio.</small>
    {readOnly && record.newAddress && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(record.newAddress)}`} target="_blank" rel="noopener noreferrer">Consultar domicilio nuevo en Google Maps</a>}
  </div>
}
