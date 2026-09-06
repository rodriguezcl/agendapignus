import React, { useState } from 'react'
import Icon from '../../../components/ui/Icon.jsx'
import RequiredLabel from '../../../presentation/components/forms/RequiredLabel.jsx'
import {
  MAX_SERVICE_ESTIMATED_MINUTES,
  normalizeServiceEstimatedMinutes
} from '../../../domain/agenda/service-scheduling.mjs'
import { formatServiceEstimatedTime } from '../../../domain/services/service.mjs'
import {
  blankService,
  buildServiceRecord,
  editableService,
  serviceIsReferenced
} from '../../../domain/services/service-catalog.mjs'

export default function ServiceTypes({ services, setServices, setNotice, ask, history, teams, weekly }) {
  const [form, setForm] = useState(blankService)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const duration = normalizeServiceEstimatedMinutes(form.estimatedMinutes)
  const durationHours = Math.floor(duration / 60)
  const durationMinutes = duration % 60

  const updateDuration = (hours, minutes) => {
    const total = Math.min(MAX_SERVICE_ESTIMATED_MINUTES, Math.max(15, Number(hours) * 60 + Number(minutes)))
    setForm(previous => ({ ...previous, estimatedMinutes: total }))
  }

  const save = event => {
    event.preventDefault()
    let record
    try {
      record = buildServiceRecord(form, editing)
    } catch (error) {
      setNotice(error.message)
      return
    }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el tipo de servicio ${record.name}?`, () => {
      setServices(previous => editing
        ? previous.map(service => service.id === editing ? record : service)
        : [...previous, record])
      setOpen(false)
      setEditing(null)
      setNotice('El tipo de servicio fue guardado correctamente.')
    })
  }

  const removeService = service => {
    if (serviceIsReferenced(service.id, history, teams, weekly)) {
      setServices(previous => previous.map(item => item.id === service.id ? { ...item, status: 'Inactivo' } : item))
      setNotice('El servicio tiene registros vinculados: se marcó como inactivo en lugar de eliminarlo.')
      return
    }
    setServices(previous => previous.filter(item => item.id !== service.id))
    setNotice('El tipo de servicio fue eliminado.')
  }

  const startCreate = () => {
    setForm(blankService())
    setEditing(null)
    setOpen(true)
  }

  const startEdit = service => {
    setForm(editableService(service))
    setEditing(service.id)
    setOpen(true)
  }

  return <>
    <div className="module-intro">
      <div><p className="eyebrow">CATÁLOGO OPERATIVO</p><h1>Tipo de servicio</h1><p>Administrá los servicios disponibles para planificar en la agenda técnica.</p></div>
      <button className="primary" onClick={startCreate}><Icon name="plus" />Nuevo servicio</button>
    </div>
    {open && <form className="service-form" onSubmit={save}>
      <label><RequiredLabel>Nombre del servicio</RequiredLabel><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label>Descripción<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
      <div className="service-duration-field"><span><RequiredLabel>Tiempo estimado</RequiredLabel></span><div className="service-duration-inputs">
        <label><input aria-label="Horas estimadas" required type="number" inputMode="numeric" min="0" max="12" step="1" value={durationHours} onChange={event => updateDuration(event.target.value, durationMinutes)} /><small>h</small></label>
        <label><select aria-label="Minutos estimados" value={durationMinutes} onChange={event => updateDuration(durationHours, event.target.value)}><option value="0">00</option><option value="15">15</option><option value="30">30</option><option value="45">45</option></select><small>min</small></label>
      </div></div>
      <button className="primary"><Icon name="check" />{editing ? 'Guardar cambios' : 'Guardar servicio'}</button>
      <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button>
    </form>}
    <div className="data-card services-table">
      <div className="table-head"><span>Servicio</span><span>Descripción</span><span>Tiempo estimado</span><span>Estado</span><span>Acciones</span></div>
      {services.map(service => <div className="service-row" key={service.id}>
        <b>{service.name}</b><span>{service.description || 'Sin descripción'}</span><strong className="service-duration-value">{formatServiceEstimatedTime(service.estimatedMinutes)}</strong>
        <div><button disabled={service.system} title={service.system ? 'Servicio interno administrado por el sistema' : ''} className={`status ${service.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar ${service.name} como ${service.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => setServices(previous => previous.map(item => item.id === service.id ? { ...item, status: item.status === 'Activo' ? 'Inactivo' : 'Activo' } : item)))}>{service.status}</button></div>
        <div className="row-actions">{service.system ? <em className="system-service-chip">Servicio del sistema</em> : <><button title="Editar servicio" onClick={() => startEdit(service)}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar servicio" onClick={() => ask('Eliminar servicio', `¿Querés eliminar ${service.name}?`, () => removeService(service), true)}><Icon name="trash" size={16} /></button></>}</div>
      </div>)}
    </div>
  </>
}
