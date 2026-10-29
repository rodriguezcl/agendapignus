import { excludedFromSubscriberCount } from '../../../domain/customers/subscriber-policy.mjs'
import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import React, { useState, useMemo, useEffect, useRef } from "react";
import { blankCustomer, customerKind, normalizeAccountKey, nextCustomerCode, customerKindLabel } from "../application/customer-model.mjs";
import { normalizeSearchText, normalizeCustomerName } from "../../../domain/shared/normalization.mjs";
import { previousSubscriberAccount } from "../../../domain/customers/customer-provenance.mjs";
import { softguardRetirementPending } from "../../../domain/customers/softguard-retirement.mjs";
import { customerImportRepository } from "../../../infrastructure/repositories/customer-import-repository.mjs";
import { applyCustomerCoordinateDraft } from "../../../domain/customers/customer-coordinates.mjs";
import { createCustomerId } from "../../../infrastructure/browser/identity.mjs";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import { CustomerDetail } from "./CustomerDetail.jsx";
import { CustomerServiceHistory } from "./CustomerServiceHistory.jsx";
import useDiscardGuard from "../../../components/ui/useDiscardGuard.jsx";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";
import CustomerCoordinatesField from "../../../components/CustomerCoordinatesField.jsx";
import { customerFromImportRow, mergeImportedCustomers } from "../../../domain/customers/customer-import.mjs";
import CustomerSync from './CustomerSync.jsx';

export function Accounts({ persistSubscriptionCorrection, services, customers, setCustomers, setNotice, ask, history, teams, weekly, permissions = {}, isAdministrator = false, stateRevision, refreshRemoteState, applyCustomerImportState }) {
  const [presenceFilter, setPresenceFilter] = useState('active'); const [search, setSearch] = useState(''); const [form, setForm] = useState(blankCustomer); const [editing, setEditing] = useState(null); const [showForm, setShowForm] = useState(false); const [importOpen, setImportOpen] = useState(false); const [detail, setDetail] = useState(null); const [customerHistory, setCustomerHistory] = useState(null)
  const [canUndoImport, setCanUndoImport] = useState(false)
  const [pageSize, setPageSize] = useState(20); const [page, setPage] = useState(1)
  const { can } = useActionPermissions()
  const detailCustomer = detail && customers.find(customer => String(customer.customerId) === String(detail.customerId))
  const canCreate = can('customers.create', isAdministrator || permissions.accountsEdit)
  const canEditIdentity = can('customers.edit', isAdministrator || permissions.accountsEdit)
  const canEdit = canEditIdentity || can('customers.coordinates', isAdministrator || permissions.accountsEdit) || can('customers.cctv', isAdministrator || permissions.accountsEdit)
  const canDelete = can('customers.delete', isAdministrator || permissions.accountsDelete)
  const canImport = can('customers.import', isAdministrator || permissions.accountsImport)
  const visible = useMemo(() => customers
    .filter(c => presenceFilter === 'all' || (c.softguardPresence?.status === 'inactive') === (presenceFilter === 'inactive'))
    .filter(c => normalizeSearchText(`${c.account} ${c.name} ${c.locality} ${previousSubscriberAccount(c)}`).includes(normalizeSearchText(search)))
    .sort((a, b) => String(a.account || '').localeCompare(String(b.account || ''), 'es', { numeric: true, sensitivity: 'base' })), [customers, search, presenceFilter])
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paginatedCustomers = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [search, pageSize, presenceFilter])
  useEffect(() => {
    if (!can('customers.backup', isAdministrator)) return
    customerImportRepository.status().then(payload => setCanUndoImport(Boolean(payload?.canUndo))).catch(() => {})
  }, [isAdministrator, can('customers.backup', isAdministrator)])
  const applyImport = async (nextCustomers, importedAccounts) => {
    if (!canImport) return
    const payload = await customerImportRepository.apply(stateRevision, nextCustomers, importedAccounts)
    const verifications = new Map((payload.addressVerifications || []).map(item => [String(item.customerId), item.softguardAddress]))
    const importedCustomers = nextCustomers.map(customer => verifications.has(String(customer.customerId)) ? { ...customer, softguardAddress: verifications.get(String(customer.customerId)) } : customer)
    setCanUndoImport(Boolean(payload.canUndo)); setImportOpen(false)
    const importedPayload = Array.isArray(payload.customers)
      ? payload
      : Number(payload.customerCount) === nextCustomers.length
        ? { ...payload, customers: importedCustomers }
        : payload
    if (applyCustomerImportState) {
      if (!applyCustomerImportState(importedPayload)) await refreshRemoteState?.()
    }
    else if (refreshRemoteState) await refreshRemoteState()
    else setCustomers(importedPayload.customers || nextCustomers)
    setNotice('Importación confirmada y guardada. Administración puede deshacerla mientras no haya otra importación o modificación de clientes.')
  }
  const undoImport = () => ask('Deshacer última importación', '¿Querés restaurar exactamente los abonados y clientes existentes antes de la última importación? Esta acción no afecta servicios ni agendas.', async () => {
    if (!can('customers.undo', isAdministrator)) return
    const payload = await customerImportRepository.undo()
    setCanUndoImport(false)
    if (applyCustomerImportState) applyCustomerImportState(payload)
    else if (refreshRemoteState) await refreshRemoteState()
    else setCustomers(payload.customers || [])
    setNotice('La última importación fue deshecha y se restauró la base anterior.')
  }, true)
  const save = e => {
    e.preventDefault()
    if (editing ? !canEdit : !canCreate) return
    const kind = customerKind(form)
    let correctedForm
    try { correctedForm = applyCustomerCoordinateDraft(form) } catch (error) { setNotice(error.message); return }
    let customer = { ...correctedForm, customerId: form.customerId || createCustomerId(), kind, ...(kind === 'subscriber' ? { excludeFromSubscriberCount: excludedFromSubscriberCount(form) } : {}), cctvService: Boolean(form.cctvService), account: normalizeAccountKey(form.account || nextCustomerCode(customers, kind)), name: normalizeCustomerName(form.name), address: [form.street, form.locality].filter(Boolean).join(', ') }
    const previous = editing ? customers.find(item => item.customerId === editing) : null
    if (previous) {
      if (!canEditIdentity) customer = { ...previous }
      if (can('customers.coordinates', canEditIdentity)) {
        if (Object.hasOwn(correctedForm, 'locationOverride')) customer.locationOverride = correctedForm.locationOverride
        else delete customer.locationOverride
      }
      if (can('customers.cctv', canEditIdentity)) customer.cctvService = Boolean(form.cctvService)
      else if (Object.hasOwn(previous, 'cctvService')) customer.cctvService = previous.cctvService
      else delete customer.cctvService
    }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar los cambios de ${customer.name}?`, () => {
      setCustomers(previous => editing ? previous.map(item => item.customerId === editing ? customer : item) : [...previous, customer])
      setShowForm(false); setEditing(null); setNotice(`${customerKindLabel(customer)} guardado correctamente.`)
    })
  }
  const edit = customer => { setForm(customer); setEditing(customer.customerId); setShowForm(true) }
  const startNew = () => { const kind = 'client'; setEditing(null); setForm({ ...blankCustomer, customerId: createCustomerId(), kind, account: nextCustomerCode(customers, kind) }); setShowForm(true) }
  const removeCustomer = customer => {
    if (!canDelete) return
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => String(record.customerId) === String(customer.customerId)) || agendaTeams.some(team => (team.tasks || []).some(task => String(task.customerId) === String(customer.customerId)))
    if (referenced) { setNotice('No se puede eliminar: el abonado o cliente tiene servicios vinculados.'); return }
    setCustomers(items => items.filter(item => item.customerId !== customer.customerId)); setNotice('El registro fue eliminado.')
  }
  return <><ModuleIntroduction><p className="eyebrow">REGISTRO COMERCIAL</p><h1>Abonados y clientes</h1><p>{canEdit || canDelete || canImport ? 'Las cuentas PIG pueden excluirse del conteo de abonados. Los códigos CLI identifican clientes sin abono.' : 'Consulta de solo lectura. Las modificaciones requieren permisos adicionales.'}</p></ModuleIntroduction><div className="accounts-bar accounts-toolbar"><label className="accounts-toolbar-search"><Icon name="search" size={16} /><input type="search" aria-label="Buscar abonados y clientes" title="Buscá por nombre, código actual, PIG anterior o localidad." placeholder="Buscar nombre, código o localidad..." value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Estado de las cuentas" value={presenceFilter} onChange={event => setPresenceFilter(event.target.value)}><option value="active">Activos</option><option value="inactive">Bajas en SoftGuard</option><option value="all">Todos</option></select><div className="action-group accounts-toolbar-actions">{can('customers.undo', isAdministrator) && <button className="secondary" disabled={!canUndoImport} title={canUndoImport ? 'Restaurá la base de abonados anterior a la última importación.' : 'No hay una importación disponible para deshacer.'} onClick={undoImport}><Icon name="history" />Deshacer última importación</button>}{canImport && <button title="Seleccioná un archivo de abonados y revisá su contenido antes de importarlo." className="secondary" onClick={() => setImportOpen(true)}><Icon name="upload" />Importar abonados</button>}{canImport && <CustomerSync administrator={isAdministrator} onComplete={refreshRemoteState} />}{canCreate && <button title="Abrí el formulario para registrar un nuevo cliente." className="primary" onClick={startNew}><Icon name="plus" />Nuevo cliente</button>}</div></div>{showForm && (editing ? canEdit : canCreate) && <CustomerForm form={form} setForm={setForm} editing={editing} customers={customers} save={save} cancel={() => setShowForm(false)} />}<div className="data-card accounts-table"><div className="table-head">{['Código', 'Abonado / Cliente', 'Dirección', 'Teléfono', 'Acciones'].map(x => <span key={x}>{x}</span>)}</div>{visible.length ? paginatedCustomers.map(customer => { const previousAccount = previousSubscriberAccount(customer); return <div className="account-row" key={customer.customerId}><b>{customer.account}</b><div><strong>{customer.name}</strong>{customer.softguardPresence?.status === 'inactive' && <small>Baja en SoftGuard</small>}<small>{customerKindLabel(customer)} · {customer.type || 'Sin categoría'}{customer.cctvService ? ' · Servicio de CCTV' : ''}</small>{previousAccount && <small className="customer-previous-account">Anteriormente abonado {previousAccount}</small>}{softguardRetirementPending(customer) && <small className="customer-softguard-pending">Baja pendiente en SoftGuard</small>}</div><div>{customer.address}</div><div>{customer.phone || 'Sin teléfono'}</div><div className="row-actions">{can('customer.history') && <button title="Consultá el historial de servicios y observaciones de este abonado o cliente." aria-label={`Ver historial de servicios de ${customer.account}`} onClick={() => setCustomerHistory(customer)}><Icon name="history" size={16} /></button>}<button title="Abrí la ficha completa de este abonado o cliente." aria-label={`Ver ficha de ${customer.account}`} onClick={() => setDetail(customer)}><Icon name="eye" size={16} /></button>{canEdit && <button title="Abrí el formulario para modificar los datos de este abonado o cliente." onClick={() => edit(customer)}><Icon name="edit" size={16} /></button>}{canDelete && <button className="delete" title="Solicitá eliminar este abonado o cliente; la acción no se puede deshacer." onClick={() => ask(`Eliminar ${customerKindLabel(customer).toLowerCase()}`, `¿Querés eliminar ${customer.account}? Esta acción no se puede deshacer.`, () => removeCustomer(customer), true)}><Icon name="trash" size={16} /></button>}</div></div> }) : <div className="empty-state">No hay abonados o clientes para mostrar.</div>}</div>{visible.length > 0 && <nav className="accounts-pagination" aria-label="Paginación de abonados y clientes"><div className="pagination-size"><span>Mostrar</span><select value={pageSize} onChange={event => setPageSize(Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select><span>registros</span></div><span className="pagination-summary">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} de {visible.length}</span><div className="pagination-controls"><button title="Mostrá la página anterior del listado de abonados y clientes." className="secondary" disabled={currentPage === 1} onClick={() => setPage(previous => Math.max(1, previous - 1))}>Anterior</button><span>Página {currentPage} de {totalPages}</span><button title="Mostrá la página siguiente del listado de abonados y clientes." className="secondary" disabled={currentPage === totalPages} onClick={() => setPage(previous => Math.min(totalPages, previous + 1))}>Siguiente</button></div></nav>}{importOpen && canImport && <ImportModal customers={customers} close={() => setImportOpen(false)} onImport={applyImport} />}{detailCustomer && <CustomerDetail customer={detailCustomer} history={history} services={services} onCorrectSubscription={can('subscriptions.correct', canEdit) ? persistSubscriptionCorrection : undefined} close={() => setDetail(null)} />}{customerHistory && can('customer.history') && <CustomerServiceHistory customer={customerHistory} history={history} close={() => setCustomerHistory(null)} />}</>
}

export function CustomerForm({ form, setForm, editing, customers, save, cancel }) {
  const { can } = useActionPermissions()
  const canEditIdentity = !editing || can('customers.edit')
  const initialForm = useRef(JSON.stringify(form))
  const { requestClose, discardDialog } = useDiscardGuard({ dirty: JSON.stringify(form) !== initialForm.current, onDiscard: cancel })
  const set = key => event => setForm({ ...form, [key]: key === 'name' ? event.target.value.toLocaleUpperCase('es-AR') : event.target.value })
  const changeKind = event => { const kind = event.target.value; setForm({ ...form, kind, account: editing ? form.account : nextCustomerCode(customers, kind) }) }
  const requiredLabel = text => <RequiredLabel>{text}</RequiredLabel>
  return <><div className="modal-layer customer-editor-layer" role="dialog" aria-modal="true" aria-label={editing ? 'Editar abonado o cliente' : 'Nuevo cliente'} onClick={event => { if (event.target === event.currentTarget) { event.stopPropagation(); requestClose() } }}><div className="modal customer-editor-modal" onMouseDown={event => event.stopPropagation()}><button title="Cerrá esta ventana y volvé a la pantalla anterior." type="button" className="close-modal" onClick={requestClose} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">{editing ? 'EDITAR REGISTRO' : 'NUEVO REGISTRO'}</p><h2>{editing ? `${form.account} · ${form.name}` : 'Crear cliente'}</h2><p>{editing ? 'Actualizá los datos del abonado o cliente seleccionado.' : 'Completá los datos obligatorios para poder usarlo en las agendas.'}</p><form className="customer-form" onSubmit={save}><label>Condición<select disabled={!!editing} value={customerKind(form)} onChange={changeKind}><option value="subscriber">Abonado</option><option value="client">Cliente</option></select></label><label>{requiredLabel('Código')}<input required readOnly value={form.account} /></label><label>{requiredLabel('Nombre')}<input required disabled={!canEditIdentity} value={form.name} onChange={set('name')} /></label><label>Categoría<input disabled={!canEditIdentity} value={form.type} onChange={set('type')} placeholder="Ej.: Residencial o Comercial" /></label><label>{requiredLabel('Calle / dirección')}<input required disabled={!canEditIdentity} value={form.street} onChange={set('street')} /></label><label>Localidad<input disabled={!canEditIdentity} value={form.locality} onChange={set('locality')} /></label><label>Provincia / Estado<input disabled={!canEditIdentity} value={form.province} onChange={set('province')} /></label><label>{requiredLabel('Teléfono / contacto')}<input required disabled={!canEditIdentity} value={form.phone} onChange={set('phone')} /></label><label>Correo de contacto<input type="email" maxLength={254} disabled={!canEditIdentity} value={form.email || ''} onChange={set('email')} /><small>Se usa para las notificaciones de tickets de esta cuenta.</small></label>{can('customers.coordinates') && <CustomerCoordinatesField form={form} setForm={setForm} />}{customerKind(form) === 'subscriber' && <label className="customer-cctv-field"><input type="checkbox" disabled={!canEditIdentity} checked={excludedFromSubscriberCount(form)} onChange={event => setForm({ ...form, excludeFromSubscriberCount: event.target.checked })} /><span><b>Excluir del conteo de abonados</b><small>La cuenta sigue disponible para servicios y CCTV, pero no integra la cartera ni el mapa de abonados. Se marca automáticamente si el nombre indica AUTOMONITOREO; podés ajustar esta clasificación.</small></span></label>}<label className="customer-cctv-field"><input type="checkbox" disabled={!can('customers.cctv')} checked={Boolean(form.cctvService)} onChange={event => setForm({ ...form, cctvService: event.target.checked })} /><span><b>Servicio de CCTV</b><small>Incluir esta cuenta en el seguimiento de Supervisión.</small></span></label><div className="modal-actions customer-form-actions"><button title="Guardá los datos de la ficha del abonado o cliente." className="primary"><Icon name="check" />Guardar {customerKindLabel(form).toLowerCase()}</button><button title="Cancelá esta operación sin aplicar los cambios del formulario." type="button" className="secondary" onClick={requestClose}><Icon name="close" size={16} />Cancelar</button></div></form></div></div>{discardDialog}</>
}

export function ImportModal({ customers, close, onImport }) {
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const importFile = async e => {
    const file = e.target.files?.[0]
    if (!file) return

    const doc = new DOMParser().parseFromString(await file.text(), 'text/html')
    const table = [...doc.querySelectorAll('table')].find(t => t.textContent.toLowerCase().includes('dealer/cuenta'))
    if (!table) return setMessage('No se encontró una tabla con la columna Dealer/Cuenta.')

    const rows = [...table.querySelectorAll('tr')]
      .map(r => [...r.querySelectorAll('th,td')].map(c => c.textContent.replace(/\s+/g, ' ').trim()))
      .filter(r => r.length)
    const headers = rows.shift()
    const imported = rows.map(row => customerFromImportRow(headers, row)).filter(Boolean)
      .map(customer => ({ ...customer, name: normalizeCustomerName(customer.name) }))
    if (!imported.length) return setMessage('El archivo no contiene registros válidos.')

    // The report is incremental: accounts not included in the file stay intact.
    // Matching accounts are updated, while missing report values preserve prior
    // customer data instead of accidentally erasing it.
    const result = mergeImportedCustomers(customers, imported, createCustomerId)
    setPreview({ ...result, importedAccounts: imported.map(customer => customer.account), total: imported.length, fileName: file.name })
    setMessage('')
  }

  const confirmImport = async () => {
    if (!preview || submitting) return
    setSubmitting(true); setMessage('')
    try { await onImport(preview.customers, preview.importedAccounts) } catch (error) { setMessage(error.message || 'No se pudo completar la importación.'); setSubmitting(false) }
  }

  return <div className="modal-layer"><div className="modal import-confirm-modal" role="dialog" aria-modal="true" aria-label="Importar abonados"><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="close-modal" disabled={submitting} onClick={close}><Icon name="close" /></button><p className="eyebrow">IMPORTACIÓN MASIVA</p><h2>Importar abonados</h2><p>Seleccioná el reporte exportado. El archivo se analiza primero y la base solo cambia después de tu confirmación.</p><label className="file-drop"><Icon name="upload" size={30} /><b>Seleccioná un archivo .xls</b><small>Formato Maestro de Cuentas</small><input type="file" accept=".xls,.html" disabled={submitting} onChange={importFile} /></label>{preview && <div className="import-preview" role="status"><b>Revisá antes de confirmar</b><span>Archivo: {preview.fileName}</span><span>{preview.total} fila(s) válidas: {preview.created} abonado(s) nuevo(s) y {preview.updated} actualización(es).</span><small>Se guardará una copia de la base actual. Administración podrá deshacerla mientras no haya otra importación o modificación de clientes.</small></div>}{message && <p className="import-error">{message}</p>}<div className="modal-actions"><button title="Cancelá esta operación sin aplicar los cambios del formulario." className="secondary" disabled={submitting} onClick={close}><Icon name="close" size={16} />Cancelar</button><button title="Aplicá la importación de abonados después de revisar el archivo seleccionado." className="primary" disabled={!preview || submitting} onClick={confirmImport}>{submitting ? 'Importando…' : 'Confirmar importación'}</button></div></div></div>
}
