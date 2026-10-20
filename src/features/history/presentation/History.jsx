import '../../../history-layout.css'
import React, { useState, useEffect, useMemo, useRef } from "react";
import { historyReminderRecords, historyStatusLabel } from "../../../domain/dashboard/dashboard-metrics.mjs";
import { normalizeRoleName } from "../../../domain/access/permissions.mjs";
import { createHistorySearchIndex, filterHistoryRecords } from "../../../domain/history/history-query.mjs";
import { sortHistoryByDateAndTime, stampServiceRecord } from "../../agenda/application/agenda-model.mjs";
import { sortOperationalHistory } from "../../../domain/history/history-order.mjs";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import { prettyDate } from "../../../presentation/formatting.mjs";
import { serviceTypesLabel, serviceTypesFor } from "../../../domain/services/multi-service.mjs";
import { HistoryDetail } from "./HistoryDetail.jsx";
import { normalizeSearchText } from "../../../domain/shared/normalization.mjs";
import { serviceRecordFingerprint } from "../../../domain/history/service-concurrency.mjs";
import { serviceColorClass } from "../../services/application/service-fields.mjs";
import { HistoryManagementDetail } from "./HistoryManagementDetail.jsx";

export function History({ history, setHistory, customers, services, employees, authUser, canManage = false, persistHistoryRecord, persistHistoryRecordRemoval, historyScheduling, initialFilter = null }) {
  const [reminderFilter, setReminderFilter] = useState(initialFilter)
  useEffect(() => { setReminderFilter(initialFilter) }, [initialFilter])
  history = useMemo(() => historyReminderRecords(history, reminderFilter), [history, reminderFilter])
  const supervisorView = authUser?.roleCode === 'supervisor' || normalizeRoleName(authUser?.role) === 'supervisor'
  const clearReminderFilter = () => setReminderFilter(null)
  return <>{canManage
    ? <HistoryManagement {...{ history, setHistory, customers, services, employees, authUser, persistHistoryRecord, persistHistoryRecordRemoval, historyScheduling, reminderFilter, clearReminderFilter }} />
    : <HistoryReadOnly history={history} customers={customers} supervisorView={supervisorView} reminderFilter={reminderFilter} clearReminderFilter={clearReminderFilter} />}</>
}

export function HistoryReadOnly({ history, customers = [], supervisorView = false, reminderFilter = null, clearReminderFilter = () => {} }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState(null)
  const searchIndex = useMemo(() => createHistorySearchIndex(history), [history])
  const records = useMemo(() => filterHistoryRecords(searchIndex, { search, compare: supervisorView ? sortHistoryByDateAndTime : sortOperationalHistory }), [searchIndex, search, supervisorView])
  const pageCount = Math.max(1, Math.ceil(records.length / 50))
  const currentPage = Math.min(page, pageCount)
  const visibleRecords = records.slice((currentPage - 1) * 50, currentPage * 50)
  useEffect(() => setPage(1), [search, reminderFilter])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">{supervisorView ? 'SEGUIMIENTO DE CUENTAS' : 'TRABAJOS REALIZADOS'}</p><h1>{supervisorView ? 'Seguimiento de CCTV' : 'Historial técnico'}</h1><p>{supervisorView ? 'Consulta de solo lectura de los abonados y clientes marcados con Servicio de CCTV.' : 'Consulta de solo lectura. Los cambios de estado y datos requieren el permiso Gestionar historial.'}</p></ModuleIntroduction>{(reminderFilter || search) && <button title="Quitá los filtros de búsqueda para volver a mostrar el listado completo." className="secondary" onClick={() => { setSearch(''); clearReminderFilter() }}><Icon name="close" size={16} />Limpiar filtros</button>}</div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Estado</span><span>Detalle</span></div>{records.length ? visibleRecords.map(record => { const recordStatus = historyStatusLabel(record); return <div className="history-row" key={record.id}><b>{prettyDate(record.date)}</b><div className="history-client"><strong>{record.client}</strong>{record.awaitingConfirmation === true && <span className="service-confirmation-label">(A CONFIRMAR)</span>}<small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{serviceTypesLabel(record)}</em></div><div><span className={`work-status ${recordStatus.toLowerCase().replace(/\s/g, '-')}`}>{recordStatus}</span></div><div><button title="Abrí los datos del servicio y las observaciones registradas." className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Ver detalle</button></div></div> }) : <div className="empty-state">{supervisorView ? 'Todavía no hay servicios de cuentas con seguimiento de CCTV.' : 'No hay trabajos para mostrar.'}</div>}</div>{pageCount > 1 && <nav className="history-pagination" aria-label="Paginación del historial"><button type="button" className="secondary" title="Consultá la página anterior de servicios del historial." disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>Página {currentPage} de {pageCount} · {records.length} servicios</span><button type="button" className="secondary" title="Consultá la página siguiente de servicios del historial." disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}{detail && <HistoryDetail customers={customers} record={detail} hideInternal={supervisorView} close={() => setDetail(null)} />}</>
}

export function HistoryBulkView({ history, setHistory, customers, services, employees, authUser, persistHistoryRecord, persistHistoryRecordRemoval, historyScheduling, reminderFilter = null, clearReminderFilter = () => {} }) {
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [selected, setSelected] = useState([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkStatus, setBulkStatus] = useState('Completado')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [serviceFilter, setServiceFilter] = useState('')
  const hasActiveFilters = Boolean(reminderFilter || search || fromDate || toDate || statusFilter !== 'all' || serviceFilter)
  const clearFilters = () => {
    setSearch(''); setFromDate(''); setToDate(''); setStatusFilter('all'); setServiceFilter('')
    setHistoryPage(1); setSelected([]); clearReminderFilter()
    document.querySelectorAll('.history-date-filters input').forEach(input => { input.value = '' })
    const selects = document.querySelectorAll('.history-date-filters select')
    if (selects[0]) selects[0].value = 'all'
    if (selects[1]) selects[1].value = ''
  }
  const historyServiceOptions = useMemo(() => [...new Map(history.flatMap(record => serviceTypesFor(record).map(type => [normalizeSearchText(type.name), String(type.name).trim()]))).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [history])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(50)
  const historyPageNavigationRef = useRef(false)
  const minimumRescheduleDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const searchIndex = useMemo(() => createHistorySearchIndex(history), [history])
  const matchingRecords = useMemo(() => filterHistoryRecords(searchIndex, { search, fromDate, toDate, serviceFilter, statusFilter }), [searchIndex, search, fromDate, toDate, serviceFilter, statusFilter])
  const historyPageCount = Math.max(1, Math.ceil(matchingRecords.length / historyPageSize))
  const currentHistoryPage = Math.min(historyPage, historyPageCount)
  const records = matchingRecords.slice((currentHistoryPage - 1) * historyPageSize, currentHistoryPage * historyPageSize)
  const technicianNames = record => record.technicians?.map(name => String(name).trim().split(/\s+/)[0]).filter(Boolean).join(' / ') || 'Sin asignar'
  const status = record => historyStatusLabel(record)
  const liveDetail = detail ? history.find(record => String(record.id) === String(detail.id)) : null
  useEffect(() => { setHistoryPage(1); setSelected([]) }, [search, fromDate, toDate, statusFilter, serviceFilter])
  useEffect(() => { if (historyPage > historyPageCount) setHistoryPage(historyPageCount) }, [historyPage, historyPageCount])
  useEffect(() => {
    setSelected(previous => {
      const available = previous.filter(id => history.some(record => record.id === id))
      return available.length === previous.length ? previous : available
    })
  }, [history])
  useEffect(() => {
    if (!historyPageNavigationRef.current) return undefined
    const frame = requestAnimationFrame(() => {
      const table = document.querySelector('.history-bulk')
      table?.focus({ preventScroll: true })
      table?.scrollIntoView({ block: 'start', behavior: 'instant' })
      historyPageNavigationRef.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [currentHistoryPage, historyPageSize])
  useEffect(() => {
    if (!detail) return
    if (!liveDetail) { setDetail(null); return }
    if (serviceRecordFingerprint(detail) !== serviceRecordFingerprint(liveDetail)) setDetail(liveDetail)
  }, [detail, liveDetail])
  const toggle = id => setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  const allPageSelected = records.length > 0 && records.every(record => selected.includes(record.id))
  const somePageSelected = records.some(record => selected.includes(record.id))
  const toggleAll = () => setSelected(previous => allPageSelected
    ? previous.filter(id => !records.some(record => record.id === id))
    : [...new Set([...previous, ...records.map(record => record.id)])])
  const applyBulk = async () => {
    if (bulkSaving || !selected.length || (bulkStatus === 'Reprogramado' && (!rescheduleDate || rescheduleDate < minimumRescheduleDate))) return
    const selectedRecords = history.filter(record => selected.includes(record.id))
    if (bulkStatus !== 'Reprogramado' && persistHistoryRecord) {
      const updates = selectedRecords.map(base => ({
        base,
        record: stampServiceRecord({ ...base, status: bulkStatus, scheduledDate: '' }, authUser)
      }))
      setBulkSaving(true)
      try {
        await persistHistoryRecord(updates)
        setSelected([])
        setBulkOpen(false)
        setRescheduleDate('')
      } finally {
        setBulkSaving(false)
      }
      return
    }
    if (bulkStatus === 'Reprogramado') history.filter(record => selected.includes(record.id)).forEach(record => {
      window.dispatchEvent(new CustomEvent('pignus:reschedule-service', { detail: { record, nextDate: rescheduleDate, sourceDate: record.date } }))
    })
    setHistory(previous => previous.map(record => {
      if (!selected.includes(record.id)) return record
      // Una reprogramación mueve la visita al nuevo día para que Agenda técnica la recupere.
      if (bulkStatus === 'Reprogramado') return stampServiceRecord({ ...record, date: rescheduleDate, status: 'Pendiente', scheduledDate: '', rescheduledFrom: record.date, reprogrammedAt: new Date().toISOString() }, authUser)
      return stampServiceRecord({ ...record, status: bulkStatus, scheduledDate: '' }, authUser)
    }))
    setSelected([]); setBulkOpen(false); setRescheduleDate('')
  }
  // Eliminar en lote requiere una confirmación independiente para evitar borrados accidentales.
  const deleteSelected = () => {
    setHistory(previous => previous.filter(record => !selected.includes(record.id)))
    setSelected([])
    setBulkOpen(false)
    setBulkDeleteConfirm(false)
  }
  useEffect(() => {
    if (!bulkOpen || !selected.length) return undefined
    const actions = document.querySelector('.bulk-modal .modal-actions')
    if (!actions || actions.querySelector('.bulk-delete-button')) return undefined
    const button = document.createElement('button'); button.title = "Solicitá eliminar los registros seleccionados; esta acción no se puede deshacer."
    button.type = 'button'
    button.className = 'danger-button bulk-delete-button'
    button.textContent = `Eliminar ${selected.length} registro(s)`
    button.onclick = () => setBulkDeleteConfirm(true)
    actions.prepend(button)
    return () => button.remove()
  }, [bulkOpen, selected.length])
  useEffect(() => {
    if (!bulkDeleteConfirm) return undefined
    const layer = document.createElement('div')
    layer.className = 'modal-layer bulk-delete-confirmation'
    layer.innerHTML = `<div class="modal confirm-modal"><span class="confirm-icon danger">🗑</span><h2>Eliminar registros</h2><p>¿Querés eliminar ${selected.length} servicio(s) seleccionados? Esta acción no se puede deshacer.</p><div class="confirm-actions"><button title="Volvé al historial sin eliminar los registros seleccionados." type="button" class="secondary"><Icon name="close" size={16} />Cancelar</button><button title="Eliminá definitivamente los registros seleccionados; no se puede deshacer." type="button" class="danger-button"><Icon name="trash" size={16} />Sí, eliminar</button></div></div>`
    const [cancelButton, confirmButton] = layer.querySelectorAll('button')
    cancelButton.onclick = () => setBulkDeleteConfirm(false)
    confirmButton.onclick = deleteSelected
    document.body.append(layer)
    return () => layer.remove()
  }, [bulkDeleteConfirm, selected])
  useEffect(() => {
    const toolbar = document.querySelector('.history-toolbar')
    if (!toolbar) return undefined
    const filters = document.createElement('div'); filters.className = 'history-date-filters'
    const createDateInput = (label, value, update) => {
      const field = document.createElement('label'); field.textContent = label
      const input = document.createElement('input'); input.type = 'date'; input.value = value
      input.onchange = event => update(event.target.value)
      field.append(input)
      return { field, input }
    }
    const from = createDateInput('Desde', fromDate, setFromDate)
    const to = createDateInput('Hasta', toDate, setToDate)
    const statusField = document.createElement('label'); statusField.textContent = 'Estado'
    const statusSelect = document.createElement('select')
    ;[['all', 'Todos'], ['Pendiente', 'Pendiente'], ['Avance registrado', 'Avance registrado'], ['Completado', 'Completado'], ['Requiere revisión', 'Requiere revisión'], ['Reprogramado', 'Reprogramado'], ['Cancelado', 'Cancelado']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; statusSelect.append(option)
    })
    statusSelect.value = statusFilter
    statusSelect.onchange = event => setStatusFilter(event.target.value)
    statusField.append(statusSelect)
    const serviceField = document.createElement('label'); serviceField.textContent = 'Tipo de servicio'
    const serviceSelect = document.createElement('select'); serviceSelect.className = 'history-service-filter'; serviceSelect.setAttribute('aria-label', 'Filtrar por tipo de servicio')
    serviceSelect.onchange = event => setServiceFilter(event.target.value)
    serviceField.append(serviceSelect)
    filters.append(from.field, to.field, statusField, serviceField)
    toolbar.prepend(filters)
    return () => filters.remove()
    // Los inputs permanecen montados mientras se usa el selector nativo de iOS.
  }, [])
  useEffect(() => {
    const select = document.querySelector('.history-service-filter')
    if (!select) return
    select.replaceChildren()
    const all = document.createElement('option'); all.value = ''; all.textContent = 'Todos los servicios'; select.append(all)
    historyServiceOptions.forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option)
    })
    if (serviceFilter && !historyServiceOptions.some(([value]) => value === serviceFilter)) setServiceFilter('')
    select.value = serviceFilter
  }, [historyServiceOptions, serviceFilter])
  useEffect(() => {
    const counter = document.querySelector('.history-toolbar>div:not(.history-date-filters)')
    if (counter) counter.innerHTML = `<b>${matchingRecords.length}</b> ${matchingRecords.length === history.length ? 'trabajos registrados' : 'trabajos encontrados'}`
  }, [fromDate, toDate, statusFilter, serviceFilter, matchingRecords.length, history.length])
  useEffect(() => {
    const table = document.querySelector('.history-bulk')
    if (!table) return undefined
    table.setAttribute('role', 'table')
    table.setAttribute('aria-label', 'Historial técnico')
    table.tabIndex = -1
    table.style.scrollMarginTop = '80px'
    const header = table.querySelector('.table-head')
    header?.setAttribute('role', 'row')
    header?.querySelectorAll(':scope > span').forEach(cell => cell.setAttribute('role', 'columnheader'))
    table.querySelectorAll('.history-row').forEach(row => {
      row.setAttribute('role', 'row')
      ;[...row.children].forEach(cell => cell.setAttribute('role', 'cell'))
    })
    const navigation = document.createElement('nav')
    navigation.className = 'history-pagination'
    navigation.setAttribute('aria-label', 'Paginación del historial')
    const summary = document.createElement('span')
    const firstRecord = matchingRecords.length ? (currentHistoryPage - 1) * historyPageSize + 1 : 0
    const lastRecord = Math.min(currentHistoryPage * historyPageSize, matchingRecords.length)
    summary.textContent = `${firstRecord}–${lastRecord} de ${matchingRecords.length}`
    const pageLabel = document.createElement('span')
    pageLabel.textContent = `Página ${currentHistoryPage} de ${historyPageCount}`
    const previous = document.createElement('button'); previous.title = "Mostrá la página anterior del historial de servicios."
    previous.type = 'button'; previous.className = 'secondary'; previous.textContent = 'Anterior'; previous.disabled = currentHistoryPage <= 1
    previous.onclick = () => { historyPageNavigationRef.current = true; setHistoryPage(page => Math.max(1, page - 1)) }
    const next = document.createElement('button'); next.title = "Mostrá la siguiente página del historial de servicios."
    next.type = 'button'; next.className = 'secondary'; next.textContent = 'Siguiente'; next.disabled = currentHistoryPage >= historyPageCount
    next.onclick = () => { historyPageNavigationRef.current = true; setHistoryPage(page => Math.min(historyPageCount, page + 1)) }
    const sizeLabel = document.createElement('label')
    sizeLabel.textContent = 'Mostrar '
    const size = document.createElement('select')
    ;[25, 50, 100].forEach(value => { const option = document.createElement('option'); option.value = String(value); option.textContent = String(value); size.append(option) })
    size.value = String(historyPageSize)
    size.onchange = event => { historyPageNavigationRef.current = true; setHistoryPage(1); setHistoryPageSize(Number(event.target.value)) }
    sizeLabel.append(size, document.createTextNode(' registros'))
    navigation.append(sizeLabel, summary, previous, pageLabel, next)
    table.insertAdjacentElement('afterend', navigation)
    return () => navigation.remove()
  }, [records, matchingRecords.length, currentHistoryPage, historyPageCount, historyPageSize])
  useEffect(() => {
    // El componente de historial conserva parte de su estructura legada; aplicar la clase
    // al chip ya renderizado evita duplicar la tabla y mantiene el color sincronizado al filtrar.
    const colorClasses = ['service-alarm', 'service-cameras', 'service-retirement', 'service-ownership', 'service-fence', 'service-survey', 'service-upgrade', 'service-other']
    document.querySelectorAll('.history-bulk .role-chip').forEach(chip => {
      chip.classList.remove(...colorClasses)
      chip.classList.add(serviceColorClass(chip.textContent))
      chip.title = chip.textContent
    })
  }, [records])
  return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Seleccioná varios servicios para confirmarlos, cancelarlos o reprogramarlos en una sola acción.</p></ModuleIntroduction><div className="history-header-actions">{records.length > 0 && <label className="history-page-selection"><input aria-label="Seleccionar esta página" type="checkbox" checked={allPageSelected} ref={node => { if (node) node.indeterminate = somePageSelected && !allPageSelected }} onChange={toggleAll} /><span>Seleccionar esta página</span></label>}{selected.length > 0 && <><span role="status">{selected.length} seleccionado(s) entre páginas</span><button type="button" className="secondary" title="Quitá todos los servicios seleccionados, también los de otras páginas." onClick={() => setSelected([])}>Quitar selección</button></>}{hasActiveFilters && <button title="Quitá los filtros de búsqueda para volver a mostrar el listado completo." className="secondary" onClick={clearFilters}><Icon name="close" size={16} />Limpiar filtros</button>}<button title="Abrí las acciones para modificar en conjunto los servicios seleccionados." className="primary" disabled={!selected.length} onClick={() => setBulkOpen(true)}><Icon name="check" />{selected.length ? `Gestionar ${selected.length} seleccionados` : 'Gestionar selección'}</button></div></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table history-bulk"><div className="table-head"><span aria-hidden="true" /><span>Fecha</span><span>Hora</span><span>Cliente</span><span>Servicio</span><span>Técnicos asignados</span><span>Estado</span><span>Acciones</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><span><input aria-label={`Seleccionar ${record.client}`} type="checkbox" checked={selected.includes(record.id)} onChange={() => toggle(record.id)} /></span><b>{prettyDate(record.date)}</b><div className="history-time" aria-label={`Hora asignada: ${record.time || record.scheduledTime ? `${record.time || record.scheduledTime} Hs` : 'A confirmar'}`}>{record.time || record.scheduledTime ? `${record.time || record.scheduledTime} Hs` : 'A confirmar'}</div><div className="history-client"><strong>{record.client}</strong>{record.awaitingConfirmation === true && <span className="service-confirmation-label">(A CONFIRMAR)</span>}<small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{serviceTypesLabel(record)}</em></div><div className="history-technicians" title={record.technicians?.join(' / ') || 'Sin asignar'}><span>{technicianNames(record)}</span></div><div><span className={`work-status ${status(record).toLowerCase().replace(/\s/g, '-')}`}>{status(record)}</span>{record.scheduledDate && <small className="scheduled-date">Para: {prettyDate(record.scheduledDate)}</small>}</div><div><button title="Abrí el servicio para revisar sus datos, informes y acciones disponibles." className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Gestionar</button></div></div>) : <div className="empty-state">No hay trabajos para mostrar.</div>}</div>{bulkOpen && <div className="modal-layer"><div className="modal bulk-modal"><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="close-modal" onClick={() => setBulkOpen(false)}><Icon name="close" /></button><p className="eyebrow">GESTIÓN MÚLTIPLE</p><h2>{selected.length} servicio(s) seleccionados</h2><p>La modificación se aplicará a todos los servicios elegidos.</p><label>Nuevo estado<select value={bulkStatus} onChange={event => setBulkStatus(event.target.value)}><option>Completado</option><option>Cancelado</option><option>Reprogramado</option></select></label>{bulkStatus === 'Reprogramado' && <label>Reprogramar para<input type="date" min={minimumRescheduleDate} value={rescheduleDate} onChange={event => setRescheduleDate(event.target.value)} /></label>}<div className="modal-actions"><button title="Cancelá esta operación sin aplicar los cambios del formulario." className="secondary" onClick={() => setBulkOpen(false)}><Icon name="close" size={16} />Cancelar</button><button title="Aplicá el estado elegido a todos los servicios seleccionados." className="primary" disabled={bulkStatus === 'Reprogramado' && (!rescheduleDate || rescheduleDate < minimumRescheduleDate)} onClick={applyBulk}><Icon name="check" size={16} />Aplicar cambios</button></div></div></div>}{detail && <HistoryManagementDetail record={detail} setHistory={setHistory} close={() => setDetail(null)} customers={customers} services={services} employees={employees} authUser={authUser} persistHistoryRecord={persistHistoryRecord} persistHistoryRecordRemoval={persistHistoryRecordRemoval} historyScheduling={historyScheduling} />}</>
}

export function HistoryManagement({ history, setHistory, customers, services, employees, authUser, persistHistoryRecord, persistHistoryRecordRemoval, historyScheduling, reminderFilter = null, clearReminderFilter = () => {} }) {
  return <HistoryBulkView {...{ history, setHistory, customers, services, employees, authUser, persistHistoryRecord, persistHistoryRecordRemoval, historyScheduling, reminderFilter, clearReminderFilter }} />


}
