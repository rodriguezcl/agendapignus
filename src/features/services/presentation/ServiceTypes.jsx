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
  editableService
} from '../../../domain/services/service-catalog.mjs'
import { serviceCatalogRepository } from '../../../infrastructure/repositories/service-catalog-repository.mjs'

export default function ServiceTypes({ services, setServices, setNotice, ask, stateRevision, refreshRemoteState }) {
  refreshRemoteState = refreshRemoteState || globalThis.__pignusRefreshRemoteState
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
    const previous = editing ? services.find(service => String(service.id) === String(editing)) : null
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el tipo de servicio ${record.name}?`, async () => {
      const payload = editing
        ? await serviceCatalogRepository.update(record, previous, stateRevision)
        : await serviceCatalogRepository.create(record, stateRevision)
      if (refreshRemoteState) await refreshRemoteState()
      else setServices(payload.services || [])
      setOpen(false)
      setEditing(null)
      setNotice('El tipo de servicio fue guardado correctamente.')
    })
  }

  const removeService = async service => {
    const payload = await serviceCatalogRepository.remove(service, stateRevision)
    if (refreshRemoteState) await refreshRemoteState()
    else setServices(payload.services || [])
    setNotice(payload.outcome === 'deactivated'
      ? 'El servicio tiene registros vinculados: se marcó como inactivo en lugar de eliminarlo.'
      : 'El tipo de servicio fue eliminado.')
  }

  const toggleStatus = async service => {
    const payload = await serviceCatalogRepository.toggleStatus(service, stateRevision)
    if (refreshRemoteState) await refreshRemoteState()
    else setServices(payload.services || [])
    setNotice(`El tipo de servicio fue marcado como ${payload.service?.status?.toLowerCase() || 'actualizado'}.`)
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
        <div><button disabled={service.system} aria-label={`${service.status === 'Activo' ? 'Desactivar' : 'Activar'} ${service.name}`} aria-pressed={service.status === 'Activo'} title={service.system ? 'Servicio interno administrado por el sistema' : ''} className={`status ${service.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar ${service.name} como ${service.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => toggleStatus(service))}>{service.status}</button></div>
        <div className="row-actions">{service.system ? <em className="system-service-chip">Servicio del sistema</em> : <><button title="Editar servicio" aria-label={`Editar ${service.name}`} onClick={() => startEdit(service)}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar servicio" aria-label={`Eliminar ${service.name}`} onClick={() => ask('Eliminar servicio', `¿Querés eliminar ${service.name}?`, () => removeService(service), true)}><Icon name="trash" size={16} /></button></>}</div>
      </div>)}
    </div>
  </>
}
