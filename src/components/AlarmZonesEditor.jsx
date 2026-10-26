import React, { useState } from 'react'
import zones from '../../api/_lib/alarm-zones.cjs'
import Icon from './ui/Icon.jsx'
import './alarm-zones.css'

export default function AlarmZonesEditor({ value, onChange, disabled, complete }) {
  const [removed, setRemoved] = useState(null)
  const completed = value.filter(zones.zoneComplete).length
  const pending = value.filter(row => (row.number === 1 || zones.zoneHasData(row)) && !zones.zoneComplete(row)).length
  const update = (number, key, text) => onChange(value.map(row => row.number === number ? { ...row, [key]: text, ...(key === 'sensor' && text !== 'Otro' ? { sensorOther: '' } : {}) } : row))
  return <section className="alarm-zones-editor" aria-labelledby="alarm-zones-title">
    <header><h3 id="alarm-zones-title">Zonas de la alarma{complete && ' *'}</h3><span>{completed} zona(s) completas</span></header>
    <p>{complete ? 'La zona 1 es obligatoria. Las demás son opcionales: dejalas vacías o quitalas si no se instalaron. Si empezás a cargar una zona, completá todos sus datos.' : 'Podés guardar las zonas incompletas en este avance y continuarlas en la próxima jornada.'}</p>
    {value.map(row => { const required = complete && (row.number === 1 || zones.zoneHasData(row)); return <fieldset className="alarm-zone-card" key={row.number} disabled={disabled}>
      <legend>Zona {String(row.number).padStart(2, '0')}</legend>
      {row.number !== 1 && <button type="button" className="secondary alarm-zone-remove" title={`Quitá la zona ${row.number}; las demás conservan su número.`} onClick={() => { setRemoved(row); onChange(value.filter(zone => zone.number !== row.number)) }}><Icon name="trash" size={15} />Quitar</button>}
      <label htmlFor={`zone-${row.number}-name`}>Nombre de la zona{required && ' *'}<input id={`zone-${row.number}-name`} value={row.name} maxLength={120} autoComplete="off" placeholder="Ej.: Puerta principal" required={required} onChange={event => update(row.number, 'name', event.target.value)} /></label>
      <div className="alarm-zone-selects">
        <label>Atributo{required && ' *'}<select aria-label={`Atributo de zona ${row.number}`} value={row.attribute} required={required} onChange={event => update(row.number, 'attribute', event.target.value)}><option value="">Seleccionar</option>{zones.ATTRIBUTES.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Tipo de sensor{required && ' *'}<select aria-label={`Sensor de zona ${row.number}`} value={row.sensor} required={required} onChange={event => update(row.number, 'sensor', event.target.value)}><option value="">Seleccionar</option>{zones.SENSORS.map(item => <option key={item}>{item}</option>)}</select></label>
      </div>
      {row.attribute && <small className="alarm-zone-help">{zones.HELP[row.attribute]}</small>}
      {row.sensor === 'Otro' && <label>Especificá el sensor{required && ' *'}<input aria-label={`Otro sensor de zona ${row.number}`} maxLength={120} value={row.sensorOther} required={required} onChange={event => update(row.number, 'sensorOther', event.target.value)} /></label>}
    </fieldset>})}
    
    {removed && <div className="alarm-zone-undo" role="status">Zona {removed.number} quitada. <button type="button" className="secondary" disabled={disabled || value.length >= zones.MAX_ZONES || value.some(row => row.number === removed.number)} onClick={() => { onChange([...value, removed].sort((a,b) => a.number-b.number)); setRemoved(null) }}>Deshacer</button></div>}
    <button type="button" className="secondary alarm-zone-add" disabled={disabled || value.length >= zones.MAX_ZONES} title="Agregá otra zona al informe de la instalación." onClick={() => onChange([...value, zones.emptyZone(Math.max(0, ...value.map(row => row.number), removed?.number || 0) + 1)])}><Icon name="plus" size={16} />Agregar zona</button>
    {complete && pending > 0 && <small>Faltan datos en {pending} zona(s). Completá nombre, atributo y sensor.</small>}
  </section>
}
