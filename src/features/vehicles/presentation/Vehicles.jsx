import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import React, { useState, useEffect } from "react";
import { sortVehiclesAlphabetically } from "../../../domain/shared/catalog-order.mjs";
import { fetchWithTimeout } from "../../../infrastructure/http/fetch-timeout.mjs";
import { vehicleRepository } from "../../../infrastructure/repositories/vehicle-repository.mjs";
import Attachments, { uploadAttachmentBatch, AttachmentDraftField } from "../../../components/Attachments.jsx";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import EditorModal from "../../../components/ui/EditorModal.jsx";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";
import VehicleInsuranceDownload from "../../../components/VehicleInsuranceDownload.jsx";
import { prettyDate, currentLocalDate } from "../../../presentation/formatting.mjs";
import VehicleMileageStats from "../../../components/VehicleMileageStats.jsx";
import VehicleControlPhotos from "../../../components/VehicleControlPhotos.jsx";

export const blankVehicle = () => ({ brand: '', model: '', year: String(new Date().getFullYear()), mileage: '', plate: '', insuranceExpiresOn: '', insuranceFileName: '', insuranceUploadedAt: '', insuranceDocumentUrl: '' })

export const readFileAsDataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('No se pudo leer el archivo.')); reader.readAsDataURL(file) })

export const insuranceExpired = (vehicle, today = currentLocalDate()) => Boolean(vehicle?.insuranceExpiresOn && vehicle.insuranceExpiresOn < today)

export function Vehicles({ history = [], vehicles, setVehicles, setNotice, ask, isAdministrator, stateRevision, refreshRemoteState, editRequest, onEditRequestHandled }) {
  const { can } = useActionPermissions()
  const [mileageVehicle, setMileageVehicle] = useState(null)
  const [photoHistory, setPhotoHistory] = useState(null)
  vehicles = sortVehiclesAlphabetically(vehicles)
  isAdministrator = isAdministrator ?? globalThis.__pignusCurrentUser?.roleCode === 'administrator'
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blankVehicle)
  const [initialForm, setInitialForm] = useState(blankVehicle)
  const [insuranceFile, setInsuranceFile] = useState(null)
  const [vehicleAttachments, setVehicleAttachments] = useState([])
  const [attachmentsPreparing, setAttachmentsPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const canEdit = can('vehicles.edit') || can('vehicles.mileage.edit') || can('vehicle.insurance.write', isAdministrator) || can('vehicle.documents.read', isAdministrator)
  const canSaveFields = !editing || can('vehicles.edit') || can('vehicles.mileage.edit') || can('vehicle.insurance.write', isAdministrator)
  const maximumYear = new Date().getFullYear() + 1
  const startCreate = () => { const next = blankVehicle(); setForm(next); setInitialForm(next); setInsuranceFile(null); setVehicleAttachments([]); setEditing(null); setOpen(true) }
  const startEdit = vehicle => { const next = { ...vehicle, year: String(vehicle.year), mileage: vehicle.mileage == null ? '' : String(vehicle.mileage) }; setForm(next); setInitialForm(next); setInsuranceFile(null); setVehicleAttachments([]); setEditing(vehicle.id); setOpen(true) }
  useEffect(() => {
    if (!editRequest) return
    const vehicle = vehicles.find(item => String(item.id) === String(editRequest))
    if (canEdit && vehicle) startEdit(vehicle)
    else setNotice(vehicle ? 'No tenés permiso para editar este vehículo.' : 'El vehículo ya no está disponible.')
    onEditRequestHandled?.()
  }, [editRequest, canEdit])
  const save = async event => {
    event.preventDefault()
    if (editing ? !canSaveFields : !can('vehicles.create')) return
    if (attachmentsPreparing) return setNotice('Esperá a que termine la preparación de los archivos.')
    const previousVehicle = vehicles.find(vehicle => vehicle.id === editing)
    let record = {
      ...previousVehicle, id: editing || globalThis.crypto?.randomUUID?.() || `vehicle-${Date.now()}`,
      ...(!editing || can('vehicles.edit') ? { brand: form.brand.trim(), model: form.model.trim(), year: Number(form.year), plate: form.plate.trim().toLocaleUpperCase('es-AR') } : {}),
      ...(!editing || can('vehicles.mileage.edit') ? { mileage: Number(form.mileage) } : {}),
      ...(can('vehicle.insurance.write', isAdministrator) ? { insuranceExpiresOn: String(form.insuranceExpiresOn || '') } : {})
    }
    const invalidMileage = (!editing || can('vehicles.mileage.edit')) && (form.mileage === '' || !Number.isInteger(record.mileage) || record.mileage < 0 || record.mileage > 99999999)
    if (!record.brand || !record.model || !record.plate || !Number.isInteger(record.year) || record.year < 1886 || record.year > maximumYear || invalidMileage) return setNotice(`Completá Marca, Modelo, Año, Kilometraje y Matrícula. El año debe estar entre 1886 y ${maximumYear}, y el kilometraje debe ser un número entero no negativo.`)
    if (vehicles.some(vehicle => vehicle.id !== editing && String(vehicle.plate || '').trim().toLocaleUpperCase('es-AR') === record.plate)) return setNotice({ message: 'Ya existe un vehículo con esa matrícula.', tone: 'error' })
    if ((insuranceFile || record.insuranceFileName) && !record.insuranceExpiresOn) return setNotice('Indicá la fecha de vencimiento del seguro.')
    if (insuranceFile && (insuranceFile.type !== 'application/pdf' || insuranceFile.size > 3_000_000)) return setNotice('Seleccioná un PDF válido de hasta 3 MB.')
    setSaving(true)
    try {
      if (insuranceFile) {
        const response = await fetchWithTimeout(`/api/vehicle-insurance/${encodeURIComponent(String(record.id))}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: insuranceFile.name, pdf: await readFileAsDataUrl(insuranceFile), insuranceExpiresOn: record.insuranceExpiresOn, vehicle: record, revision: stateRevision }) }, 60000)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el seguro.')
        record = payload.vehicle || { ...record, insuranceFileName: payload.fileName, insuranceUploadedAt: payload.uploadedAt, insuranceDocumentUrl: payload.documentUrl }
        if (refreshRemoteState) await refreshRemoteState()
        else setVehicles(previous => editing ? previous.map(vehicle => vehicle.id === editing ? record : vehicle) : [...previous, record])
      } else {
        const payload = editing
          ? await vehicleRepository.update(record, previousVehicle, stateRevision)
          : await vehicleRepository.create(record, stateRevision)
        if (refreshRemoteState) await refreshRemoteState()
        else setVehicles(payload.vehicles || [])
      }
      setEditing(record.id)
      setForm(record)
      await uploadAttachmentBatch('vehicle', record.id, vehicleAttachments)
      setVehicleAttachments([])
      setOpen(false)
      setNotice(editing ? 'Los datos del vehículo fueron actualizados.' : 'El vehículo fue agregado a la flota.')
    } catch (error) { setNotice(error.message) }
    finally { setSaving(false) }
  }
  const remove = vehicle => ask('Eliminar vehículo', `¿Querés eliminar ${vehicle.brand} ${vehicle.model} · ${vehicle.plate}?`, async () => {
    const payload = await vehicleRepository.remove(vehicle, stateRevision)
    if (refreshRemoteState) await refreshRemoteState()
    else setVehicles(payload.vehicles || [])
    setNotice('El vehículo fue eliminado de la flota.')
  }, true)
  return <>
    <div className="module-intro"><ModuleIntroduction><p className="eyebrow">FLOTA DE LA EMPRESA</p><h1>Flota</h1><p>Administrá la flota y mantené disponible la documentación vigente.</p></ModuleIntroduction>{can('vehicles.create') && <button title="Abrí el formulario para registrar un vehículo de la empresa." className="primary" onClick={startCreate}><Icon name="plus" />Nuevo vehículo</button>}</div>
    {open && <EditorModal active={Boolean(editing)} title="Editar vehículo" onClose={() => setOpen(false)} busy={saving || attachmentsPreparing} dirty={JSON.stringify(form) !== JSON.stringify(initialForm) || Boolean(insuranceFile) || vehicleAttachments.length > 0}>{({ requestClose }) => <form className="vehicle-form" onSubmit={save} aria-busy={saving || attachmentsPreparing}>
      <label><RequiredLabel>Marca</RequiredLabel><input required maxLength="80" autoFocus disabled={Boolean(editing) && !can('vehicles.edit')} value={form.brand} onChange={event => setForm({ ...form, brand: event.target.value })} /></label>
      <label><RequiredLabel>Modelo</RequiredLabel><input required maxLength="120" disabled={Boolean(editing) && !can('vehicles.edit')} value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} /></label>
      <label><RequiredLabel>Año</RequiredLabel><input required type="number" inputMode="numeric" min="1886" max={maximumYear} disabled={Boolean(editing) && !can('vehicles.edit')} value={form.year} onChange={event => setForm({ ...form, year: event.target.value })} /></label>
      <label><RequiredLabel>Kilometraje</RequiredLabel><input required type="number" inputMode="numeric" min="0" max="99999999" step="1" disabled={Boolean(editing) && !can('vehicles.mileage.edit')} value={form.mileage} onChange={event => setForm({ ...form, mileage: event.target.value })} /></label>
      <label><RequiredLabel>Matrícula</RequiredLabel><input required maxLength="20" autoCapitalize="characters" disabled={Boolean(editing) && !can('vehicles.edit')} value={form.plate} onChange={event => setForm({ ...form, plate: event.target.value.toLocaleUpperCase('es-AR') })} /></label>
      {can('vehicle.insurance.write', isAdministrator) && <><label>Seguro vigente (PDF)<input type="file" accept="application/pdf,.pdf" onChange={event => setInsuranceFile(event.target.files?.[0] || null)} /></label><label>Válido hasta<input type="date" value={form.insuranceExpiresOn || ''} onChange={event => setForm({ ...form, insuranceExpiresOn: event.target.value })} /></label>{form.insuranceFileName && <small className="vehicle-insurance-current">Archivo actual: {form.insuranceFileName}</small>}</>}{can('vehicle.documents.upload', isAdministrator) && <AttachmentDraftField scope="vehicle" files={vehicleAttachments} onChange={setVehicleAttachments} onPreparing={setAttachmentsPreparing} disabled={saving} />}{editing && can('vehicle.documents.read', isAdministrator) && <Attachments key={editing} scope="vehicle" entityId={editing} />}
        <div className="modal-actions vehicle-form-actions">{canSaveFields && <button title="Guardá los datos y la documentación del vehículo." className="primary" disabled={saving}><Icon name="check" />{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar vehículo'}</button>}<button title="Cancelá esta operación sin aplicar los cambios del formulario." type="button" className="secondary" disabled={saving || attachmentsPreparing} onClick={requestClose}><Icon name="close" size={16} />Cancelar</button></div>
    </form>}</EditorModal>}
    <div className="data-card vehicles-table"><div className="table-head"><span>Vehículo</span><span>Año</span><span>Kilometraje</span><span>Matrícula</span><span>Seguro</span><span>Controles vehiculares</span><span>Acciones</span></div>{vehicles.length ? vehicles.map(vehicle => <div className="vehicle-row" key={vehicle.id}><b>{vehicle.brand} {vehicle.model}</b><span>{vehicle.year}</span><span>{vehicle.mileage == null ? 'Sin registrar' : `${Number(vehicle.mileage).toLocaleString('es-AR')} km`}{can('vehicles.mileage.read') && <button type="button" className="vehicle-mileage-link" title="Ver kilómetros mensuales y promedio estimado" onClick={() => setMileageVehicle(vehicle)}>Ver estadísticas</button>}</span><strong>{vehicle.plate}</strong><span className={insuranceExpired(vehicle) ? 'insurance-expired' : ''}>{can('vehicle.insurance.read') && vehicle.insuranceFileName ? <><VehicleInsuranceDownload vehicle={vehicle} /><small>{vehicle.insuranceExpiresOn ? `Vence ${prettyDate(vehicle.insuranceExpiresOn)}` : 'Sin vencimiento informado'}</small></> : 'Sin seguro cargado'}</span><span>{can('vehicle.controls.read') && <button type="button" className="secondary small" title="Consultá las fotos de los controles de este vehículo, ordenadas por fecha." onClick={() => setPhotoHistory(vehicle)}><Icon name="history" size={16} />Historial de fotos</button>}</span><div className="row-actions">{canEdit && <button title="Abrí el formulario para modificar los datos y documentos del vehículo." onClick={() => startEdit(vehicle)}><Icon name="edit" size={16} /></button>}{can('vehicles.delete') && <button className="delete" title="Solicitá quitar este vehículo del registro de la empresa." onClick={() => remove(vehicle)}><Icon name="trash" size={16} /></button>}</div></div>) : <div className="empty-state">Todavía no hay vehículos registrados.</div>}</div>
    {mileageVehicle && can('vehicles.mileage.read') && <EditorModal active title={`Kilometraje · ${mileageVehicle.brand} ${mileageVehicle.model} · ${mileageVehicle.plate}`} eyebrow="USO DEL VEHÍCULO" onClose={() => setMileageVehicle(null)}><VehicleMileageStats history={history} vehicleId={mileageVehicle.id} today={currentLocalDate()} /></EditorModal>}
    {photoHistory && can('vehicle.controls.read') && <EditorModal active title={`Controles de ${photoHistory.brand} ${photoHistory.model} · ${photoHistory.plate}`} eyebrow="HISTORIAL DE FOTOS" onClose={() => setPhotoHistory(null)}><div className="vehicle-photo-history">{history.filter(record => record.vehicleControl && String(record.vehicleId) === String(photoHistory.id) && !((record.status || 'Pendiente') === 'Pendiente' && record.date > currentLocalDate())).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(record => <VehicleControlPhotos key={record.id} record={record} />)}{!history.some(record => record.vehicleControl && String(record.vehicleId) === String(photoHistory.id) && !((record.status || 'Pendiente') === 'Pendiente' && record.date > currentLocalDate())) && <p>No hay controles para mostrar en el historial de este vehículo.</p>}</div></EditorModal>}
  </>
}
