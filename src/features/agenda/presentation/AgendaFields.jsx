import { canWriteRecord } from '../../../domain/access/record-scope.mjs'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import ReschedulingHistory from "../../../components/ReschedulingHistory.jsx";
import { technicalReporter, prettyReportDateTime, historyRecordForTask, agendaServiceProgress, taskStatus, statusClassName, taskForScheduleOccupancy } from "../application/agenda-model.mjs";
import { completionLabel } from "../../../domain/agenda/completion-label.mjs";
import '../../../components/work-completion.css'
import { serviceTypesFor, serviceChargePatch, serviceChargesTotal } from "../../../domain/services/multi-service.mjs";
import { serviceColorClass, normalizeInternalChecklist, createInternalChecklistItem, serviceExtraAvailability, normalizeFormValue, FORM_OPTIONS, PAYMENT_OPTIONS, normalizeCurrencyAmount, formatCurrencyAmount } from "../../services/application/service-fields.mjs";
import React, { useState, useEffect, useMemo, useRef, useId } from "react";
import { normalizeSearchText } from "../../../domain/shared/normalization.mjs";
import { customerKind } from "../../customers/application/customer-model.mjs";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import { normalizeServiceEstimatedMinutes, MAX_SERVICE_ESTIMATED_MINUTES } from "../../../domain/agenda/service-scheduling.mjs";
import { FrozenMonthsFields } from "../../../components/FrozenMonths.jsx";
import { canChangeServiceConfirmation } from "../../../domain/agenda/service-confirmation.mjs";
import { currentLocalDate, prettyDate } from "../../../presentation/formatting.mjs";
import { createPortal } from "react-dom";
import { Confirm } from "../../../presentation/components/Confirm.jsx";
import { holidayDecisionLabel } from "../../../domain/agenda/holidays.mjs";

export function HolidayDecisionPanel({ holiday, decision, canDecide, onDecision, compact = false }) {
  const { can } = usePermissions()
  canDecide = canDecide && can('weekly.holidays')
  const [pendingStatus, setPendingStatus] = useState(null)
  useEffect(() => setPendingStatus(null), [holiday?.date, decision?.status])
  if (!holiday) return null
  const status = holidayDecisionLabel(decision)
  return <><section className={`holiday-decision ${compact ? 'compact' : ''} ${decision?.status || 'pending'}`} role="status"><div className="holiday-decision-icon"><Icon name="calendar" size={20} /></div><div className="holiday-decision-copy"><p className="eyebrow">FERIADO NACIONAL · {status.toUpperCase()}</p><h3>{holiday.name}</h3><p>{decision?.status === 'working' ? 'La fecha fue habilitada como jornada laboral y admite servicios normalmente.' : decision?.status === 'closed' ? 'La fecha fue definida como no operativa. La agenda permanece bloqueada.' : 'Antes de cargar servicios, definí si la empresa trabajará durante este feriado.'}</p>{decision?.decidedByName && <small>Definido por {decision.decidedByName}.</small>}</div>{canDecide ? <div className="holiday-decision-actions"><button title="Habilitá este feriado como día laboral para planificar servicios." type="button" className={decision?.status === 'working' ? 'primary' : 'secondary'} disabled={decision?.status === 'working'} onClick={() => setPendingStatus('working')}><Icon name="check" size={16} />Día laboral</button><button title="Marcá este feriado como no operativo para evitar la planificación de servicios." type="button" className={decision?.status === 'closed' ? 'danger-button' : 'secondary'} disabled={decision?.status === 'closed'} onClick={() => setPendingStatus('closed')}><Icon name="lock" size={16} />Día no operativo</button></div> : !decision && <small className="holiday-admin-note">Pendiente de definición por un administrador.</small>}</section>{pendingStatus && createPortal(<Confirm title={`${decision ? 'Cambiar definición del feriado' : 'Definir feriado'}: ${pendingStatus === 'working' ? 'día laboral' : 'día no operativo'}`} detail={`${holiday.name}${holiday.date ? ` · ${prettyDate(holiday.date)}` : ''}${decision ? `. Definición actual: ${status}.` : '.'} ${pendingStatus === 'working' ? 'Se habilitará la fecha para planificar servicios.' : 'Se bloqueará la planificación de la fecha. Los servicios ya cargados no se cancelan ni se reprograman automáticamente: revisalos antes de confirmar.'} Los controles vehiculares pendientes podrán cambiar de fecha según el calendario operativo. Podés revertir esta decisión desde los mismos botones.`} confirmLabel={pendingStatus === 'working' ? 'Confirmar día laboral' : 'Confirmar día no operativo'} action={() => { if (!canDecide) throw new Error('Ya no tenés permiso para definir el feriado.'); return onDecision(pendingStatus) }} close={() => setPendingStatus(null)} />, document.body)}</>
}

export function AgendaTechnicalNote({ record }) {
  const { can } = usePermissions()
  if (!can('service.documents.read')) return <ReschedulingHistory record={record} />
  if (!record?.technicalObservation && !record?.technicalReportedAt) return <ReschedulingHistory record={record} />
  return <><ReschedulingHistory record={record} /><div className="technician-report-detail agenda-technical-note"><b>{technicalReporter(record)} indicó · {record.technicalStatus || 'Estado informado'}</b><p>{record.technicalObservation || 'Servicio informado sin observaciones adicionales.'}</p>{record.technicalReportedAt && <small>Informado el {prettyReportDateTime(record.technicalReportedAt)}</small>}</div></>
}

export function TaskStatusBadge({ task, date, history, weekly = false, statusOnly = false }) {
  const record = historyRecordForTask(task, date, history)
  const { status, startedLabel } = agendaServiceProgress(record, taskStatus(task, date, history))
  if (!status) return null
  if (statusOnly) return <em className={`work-status ${statusClassName(status)}`}>{status}</em>
  const service = String(task?.service || 'Sin tipo de servicio').trim()
  const occupancyTask = taskForScheduleOccupancy(task, date, history)
  const releaseLabel = occupancyTask ? completionLabel(occupancyTask) : ''
return <><div className={`agenda-task-status ${weekly ? 'weekly-agenda-task-status' : 'daily-agenda-task-status'}`}>{!weekly && <em className={`work-status ${statusClassName(status)}`}>{status}</em>}{startedLabel && <small className="service-started-label" title="Hora de inicio registrada al presionar Iniciar servicio">{startedLabel}</small>}{status === 'Sin guardar' && <small className="unsaved-service-help">Guardá la agenda para habilitarlo al técnico.</small>}{weekly && task?.subscriberReservation && <em className="role-chip subscriber-reservation-chip">Reserva · PIG pendiente</em>}{weekly && serviceTypesFor(task).map(type => <em key={type.id || type.name} className={`role-chip agenda-service-chip ${serviceColorClass(type.name)}`} title={type.name}>{type.name}</em>)}{releaseLabel && <small title="Hora de finalización; la demora se calcula respecto del tiempo estimado.">{releaseLabel}</small>}</div>{(!weekly && ['Completado', 'Avance registrado'].includes(status) || Boolean(record?.technicalStatus || record?.technicalObservation || record?.technicalReportedAt)) && <details className="agenda-report-disclosure" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><summary title="Desplegá u ocultá la observación de administración y el informe del técnico."><span className="report-show">Ver informe técnico</span><span className="report-hide">Ocultar informe técnico</span></summary><div className="agenda-admin-note"><b>Observación de agenda / Administración</b><p>{record?.detail || task.detail || 'Sin observaciones cargadas.'}</p></div><AgendaTechnicalNote record={record || task} /></details>}</>
}

export function CustomerAutocomplete({ value = '', customerId = '', customers = [], subscriberReservation = false, awaitingConfirmation = false, onTextCommit, onCustomerSelect, onAddCustomer, onReserveSubscriber, className = '', required = true, disabled = false }) {
  const { can } = usePermissions()
  const canLink = !disabled && can(subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')
  const canCreate = !disabled && can('customers.create') && can('planning.linkAccount')
  const canReserve = !disabled && can('planning.reservation.create')
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => setQuery(value || ''), [value])

  const normalizedQuery = normalizeSearchText(query)
  const selectedCustomer = customers.find(customer => String(customer.customerId || '') === String(customerId || ''))
  const selectedLabel = selectedCustomer ? `${selectedCustomer.account} ${selectedCustomer.name}` : ''
  const selectionIsIntact = Boolean(selectedCustomer) && normalizeSearchText(selectedLabel) === normalizedQuery
  const suggestions = useMemo(() => {
    if (normalizedQuery.length < 2 || selectionIsIntact) return []
    const availableCustomers = customers.filter(customer => customer.softguardPresence?.status !== 'inactive' && (!subscriberReservation || customerKind(customer) === 'subscriber'))
    return availableCustomers
      .map(customer => {
        const searchable = normalizeSearchText(`${customer.account} ${customer.name} ${customer.phone || ''}`)
        const account = normalizeSearchText(customer.account)
        const name = normalizeSearchText(customer.name)
        const priority = account.startsWith(normalizedQuery) ? 0 : name.startsWith(normalizedQuery) ? 1 : searchable.includes(normalizedQuery) ? 2 : 3
        return { customer, priority }
      })
      .filter(item => item.priority < 3)
      .sort((left, right) => left.priority - right.priority || String(left.customer.name).localeCompare(String(right.customer.name), 'es'))
      .slice(0, 12)
      .map(item => item.customer)
  }, [customers, normalizedQuery, selectionIsIntact, subscriberReservation])

  useEffect(() => setActiveIndex(-1), [normalizedQuery])

  const choose = customer => {
    if (!canLink) return
    setQuery(`${customer.account} ${customer.name}`)
    setOpen(false)
    setActiveIndex(-1)
    onCustomerSelect(customer)
  }
  const commitText = () => {
    if (!canLink) return
    const availableCustomers = customers.filter(customer => customer.softguardPresence?.status !== 'inactive' && (!subscriberReservation || customerKind(customer) === 'subscriber'))
    // El nombre por sí solo no identifica una cuenta: dos personas pueden ser
    // homónimas. La selección automática sólo es segura con el código o con la
    // etiqueta completa; por nombre se exige elegir una sugerencia.
    const exact = availableCustomers.find(customer => [customer.account, `${customer.account} ${customer.name}`]
      .some(label => normalizeSearchText(label) === normalizedQuery))
    if (exact) choose(exact)
    else if (query !== value) { if (onTextCommit) onTextCommit(query); else setQuery(value || '') }
  }
  const handleKeyDown = event => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(index => Math.min(index + 1, suggestions.length - 1))
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const customer = suggestions[activeIndex >= 0 ? activeIndex : 0]
      if (customer) choose(customer)
      else commitText()
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setQuery(value || '')
      setOpen(false)
    }
  }

  const showResults = (canLink || canCreate || canReserve) && open && normalizedQuery.length >= 2 && !selectionIsIntact
  return <div className={`customer-autocomplete ${className}`.trim()} onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    commitText()
    setOpen(false)
  }}>
    <label><RequiredLabel required={required}>Abonado o cliente</RequiredLabel></label>
    <div className="customer-autocomplete-control">
      <input disabled={disabled || !(canLink || canCreate || canReserve)} autoComplete="off" spellCheck={false} role="combobox" aria-required={required} aria-autocomplete="list" aria-expanded={showResults} placeholder="Buscá por nombre, cuenta o teléfono" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true) }} onKeyDown={handleKeyDown} />
      <span aria-hidden="true">⌄</span>
    </div>
    {awaitingConfirmation && <span className="service-confirmation-label">(A CONFIRMAR)</span>}
    {showResults && <div className="customer-autocomplete-results" role="listbox">
      {canLink && suggestions.map((customer, index) => <button title={`Seleccioná ${customer.account} · ${customer.name} como cliente de este servicio.`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'active' : ''} key={customer.customerId || customer.account} onClick={() => choose(customer)}><strong>{customer.account}</strong><span>{customer.name}</span></button>)}
      {!suggestions.length && <div className="customer-autocomplete-empty"><p>No encontramos coincidencias.</p></div>}
      {(onReserveSubscriber || onAddCustomer) && <div className="customer-autocomplete-actions">
        {canReserve && onReserveSubscriber && <button title="Reservá el servicio para un futuro abonado PIG sin crear un cliente CLI." type="button" disabled={!query.trim()} className="secondary customer-reservation-button" onClick={() => { if (!query.trim()) return; onReserveSubscriber(query.trim()); setOpen(false) }}><Icon name="calendar" size={15} />Reservar nuevo abonado</button>}
        {canCreate && onAddCustomer && !subscriberReservation && <button title="Completá los datos de un nuevo cliente CLI y vinculalo al servicio al guardar." type="button" disabled={!query.trim()} className="secondary customer-add-button" onClick={() => { if (!query.trim()) return; onAddCustomer(query.trim()); setOpen(false) }}><Icon name="plus" size={15} />Agregar cliente CLI</button>}
      </div>}
    </div>}
    {subscriberReservation && <small className="subscriber-reservation-note">Reserva PIG pendiente: vinculala con el abonado importado cuando esté disponible.</small>}
  </div>
}

export function LunchCard({ hours }) {
  if (!hours || hours.breakStart >= hours.max || hours.breakEnd <= hours.min) return null
  return <aside className="lunch-break-card" style={{ margin: '8px 10px', padding: '8px 12px', border: '1px dashed #b9c7bd', borderRadius: 8, fontSize: 12 }}><strong>Almuerzo entre las {hours.breakStart} y las {hours.breakEnd} hs</strong></aside>
}

export function ServiceEstimatedDurationField({ value, onChange, className = '', required = true, disabled = false }) {
  const fieldId = useId()
  const duration = normalizeServiceEstimatedMinutes(value)
  const options = Array.from({ length: MAX_SERVICE_ESTIMATED_MINUTES / 15 }, (_, index) => (index + 1) * 15)
  // Preserve saved custom durations without silently rounding existing services.
  if (!options.includes(duration)) options.push(duration)
  options.sort((first, second) => first - second)
  const optionLabel = total => {
    const hours = Math.floor(total / 60), minutes = total % 60
    if (!hours) return `${minutes} minutos`
    return `${hours} ${hours === 1 ? 'hora' : 'horas'}${minutes ? ` ${minutes} min` : ''}`
  }
  return <div className={`task-duration-field ${className}`.trim()}>
    <label htmlFor={fieldId}><RequiredLabel required={required}>Tiempo estimado</RequiredLabel></label>
    <select id={fieldId} disabled={disabled} required={required} value={duration} onChange={event => onChange(Number(event.target.value))}>
      {options.map(total => <option key={total} value={total}>{optionLabel(total)}</option>)}
    </select>
  </div>
}

export function BufferedTextarea({ value, onCommit, delay = 500, ...textareaProps }) {
  const normalizedValue = String(value || '')
  const [draft, setDraft] = useState(normalizedValue)
  const focused = useRef(false)
  const timer = useRef(null)
  const externalValue = useRef(normalizedValue)
  const commitHandler = useRef(onCommit)

  useEffect(() => { commitHandler.current = onCommit }, [onCommit])
  useEffect(() => {
    externalValue.current = normalizedValue
    if (!focused.current) setDraft(normalizedValue)
  }, [normalizedValue])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = nextValue => {
    window.clearTimeout(timer.current)
    timer.current = null
    if (nextValue === externalValue.current) return
    externalValue.current = nextValue
    commitHandler.current(nextValue)
  }

  return <textarea
    {...textareaProps}
    value={draft}
    onFocus={() => { focused.current = true }}
    onChange={event => {
      const nextValue = event.target.value
      setDraft(nextValue)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => commit(nextValue), delay)
    }}
    onBlur={() => {
      focused.current = false
      commit(draft)
    }}
  />
}

export function InternalPreparationFields({ task, onChange, buffered = false, readOnly = false }) {
  const { can } = usePermissions()
  const notesDisabled = readOnly || !can('planning.notes')
  const checklistDisabled = readOnly || !can('planning.checklist')
  const checklist = normalizeInternalChecklist(task?.internalChecklist)
  const changeChecklist = next => onChange({ internalChecklist: normalizeInternalChecklist(next) })
  const updateItem = (id, patch) => changeChecklist(checklist.map(item => item.id === id ? { ...item, ...patch } : item))
  const note = String(task?.internalNote || '')
  if (notesDisabled && checklistDisabled) return <section className="internal-preparation internal-preparation-readonly"><div className="internal-preparation-heading"><div><b>Nota interna</b><small>Información operativa para Administración y usuarios</small></div></div><p className="internal-note-value">{note.trim() || 'Sin nota interna'}</p>{checklist.length > 0 && <div className="internal-checklist"><b>Checklist de preparación</b>{checklist.map(item => <label className="internal-checklist-item readonly" key={item.id}><input type="checkbox" checked={item.completed} readOnly /><span className={item.completed ? 'completed' : ''}>{item.text || 'Elemento sin descripción'}</span></label>)}</div>}</section>
  return <section className="internal-preparation"><div className="internal-preparation-heading"><div><b>Nota interna</b><small>Visible sólo para Administración y usuarios. No se comparte con técnicos.</small></div>{!checklistDisabled && checklist.length === 0 && <button title="Creá una lista interna de tareas de preparación para administración y usuarios." type="button" className="secondary compact" onClick={() => changeChecklist([createInternalChecklistItem()])}><Icon name="check" size={15} />Crear checklist</button>}</div><label className="internal-note-field">Anotaciones{buffered ? <BufferedTextarea readOnly={notesDisabled} maxLength={5000} value={note} onCommit={value => onChange({ internalNote: value })} placeholder="Ej.: No pedir al proveedor; hay stock disponible." /> : <textarea readOnly={notesDisabled} maxLength={5000} value={note} onChange={event => onChange({ internalNote: event.target.value })} placeholder="Ej.: No pedir al proveedor; hay stock disponible." />}</label>{checklist.length > 0 && <div className="internal-checklist"><div className="internal-checklist-heading"><b>Checklist de preparación</b><button title="Agregá una tarea a la lista interna de preparación." type="button" className="secondary compact" disabled={checklistDisabled || checklist.length >= 30} onClick={() => changeChecklist([...checklist, createInternalChecklistItem()])}><Icon name="plus" size={14} />Agregar elemento</button></div>{checklist.map(item => <div className="internal-checklist-item" key={item.id}><input disabled={checklistDisabled} type="checkbox" checked={item.completed} aria-label={`Marcar ${item.text || 'elemento'} como preparado`} onChange={event => updateItem(item.id, { completed: event.target.checked })} /><BufferedInput readOnly={checklistDisabled} maxLength={500} value={item.text} onCommit={value => updateItem(item.id, { text: value })} placeholder="Elemento a preparar" /><button disabled={checklistDisabled} type="button" className="icon-btn delete" title="Quitá este elemento de la lista interna de preparación." aria-label="Eliminar elemento del checklist" onClick={() => changeChecklist(checklist.filter(current => current.id !== item.id))}><Icon name="trash" size={15} /></button></div>)}</div>}</section>
}

export function ServiceExtraFields({ className, task, service, onChange, buffered = false, readOnly = false }) {
  const costHelpId = React.useId()
  const { can } = usePermissions()
  const commercialDisabled = readOnly || !can('planning.commercial')
  const available = serviceTypesFor(task).reduce((all, type) => { const flags = serviceExtraAvailability(type, task?.installationZone); return Object.fromEntries(Object.keys(flags).map(key => [key, all[key] || flags[key]])) }, serviceExtraAvailability(service, task?.installationZone))
  const fields = [
    ['paymentMethod', 'Forma de pago'],
    ['amount', 'Monto'],
    ['monthlyFee', 'Abono mensual'],
    ['form', 'Formulario'],
    ['formEmail', 'Email']
  ]
  return <><InternalPreparationFields task={task} onChange={onChange} buffered={buffered} readOnly={readOnly} /><div className={className}>{available.freezeMonthlyFee && <FrozenMonthsFields task={task} onChange={onChange} disabled={readOnly} />}{fields.map(([key, label]) => {
    if (!can('records.financial')) return null
    const enabled = key === 'amount' ? available.paymentMethod && Boolean(task?.paymentMethod) && task.paymentMethod !== 'No aplica' : available[key]
    if (key === 'formEmail') {
      if (!available.form || normalizeFormValue(task?.form) !== FORM_OPTIONS[0]) return null
      return <label className="service-extra-field" key={key}>{label}<input disabled={commercialDisabled} type="email" autoComplete="off" value={task?.formEmail || ''} placeholder="Correo utilizado para completar el formulario" onChange={event => onChange({ formEmail: event.target.value })} /></label>
    }
    if ((key === 'amount' || key === 'monthlyFee') && !enabled) return null
    const props = {
      value: enabled ? task?.[key] || '' : '',
      disabled: !enabled || commercialDisabled,
      placeholder: enabled ? '' : 'No aplica',
      title: enabled ? '' : 'Este campo no aplica para el tipo de servicio o la ubicación seleccionados.'
    }
    if (key === 'form') {
      return <label className="service-extra-field service-extra-form" key={key}>{label}<select value={enabled ? normalizeFormValue(task?.form) : ''} disabled={!enabled || commercialDisabled} title={props.title} onChange={event => onChange({ form: event.target.value, ...(event.target.value !== FORM_OPTIONS[0] ? { formEmail: '' } : {}) })}><option value="">{enabled ? 'Seleccionar' : 'No aplica'}</option>{enabled && FORM_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
    }
    if (key === 'paymentMethod') {
      const paymentValue = enabled ? task?.paymentMethod || '' : ''
      const legacyValue = paymentValue && !PAYMENT_OPTIONS.includes(paymentValue) ? paymentValue : ''
      return <label className="service-extra-field" key={key}>{label}<select value={paymentValue} disabled={!enabled || commercialDisabled} title={props.title} onChange={event => onChange({ paymentMethod: event.target.value, ...(!event.target.value || event.target.value === 'No aplica' ? { amount: '', serviceCharges: undefined } : {}) })}><option value="">{enabled ? 'Seleccionar' : 'No aplica'}</option>{legacyValue && <option value={legacyValue}>{legacyValue}</option>}{enabled && PAYMENT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
    }
    if (key === 'amount' && serviceTypesFor(task).length > 1) {
      const total = serviceChargesTotal(task.serviceCharges)
      return <fieldset key={key} className="work-completion-fields service-costs"><legend>Costo de cada trabajo</legend><p>Ingresá el costo de cada trabajo. Usá 0 si es sin cargo; el total se calcula automáticamente.</p>
        {!task.serviceCharges && Number(task.amount) > 0 && <p>Monto anterior sin desglose: {formatCurrencyAmount(task.amount)}. Completá los costos para recalcularlo.</p>}
        {serviceTypesFor(task).map(type => <label key={type.id}><RequiredLabel>{type.name}</RequiredLabel><CurrencyInput required disabled={commercialDisabled} inputMode="decimal" placeholder="Ingresar costo o 0" value={task.serviceCharges?.find(row => String(row.id) === String(type.id))?.amount ?? ''} onCommit={amount => onChange(serviceChargePatch(task, type.id, amount))} /></label>)}
        <label className="service-costs-total">Monto total<input type="text" readOnly value={formatCurrencyAmount(total)} placeholder="Calculado automáticamente" aria-describedby={costHelpId} /></label><small id={costHelpId}>Suma automática de los costos ingresados.</small>
      </fieldset>
    }
    if (key === 'amount') {
      const required = task?.paymentMethod !== 'A confirmar'
      const amountProps = { ...props, inputMode: 'decimal', required, placeholder: required ? 'Ingresar monto' : 'Opcional' }
      return <label className="service-extra-field" key={key}>{required ? <RequiredLabel>{label}</RequiredLabel> : label}<CurrencyInput {...amountProps} buffered={buffered} onCommit={value => onChange({ amount: value, serviceCharges: undefined })} /></label>
    }
    if (key === 'monthlyFee') {
      const monthlyFeeProps = { ...props, required: enabled, inputMode: 'decimal', placeholder: enabled ? 'Ingresar abono mensual' : props.placeholder }
      return <label className="service-extra-field" key={key}>{label}<CurrencyInput {...monthlyFeeProps} buffered={buffered} onCommit={value => onChange({ monthlyFee: value })} /></label>
    }
    return <label className="service-extra-field" key={key}>{label}{buffered
      ? <BufferedInput {...props} onCommit={value => onChange({ [key]: value })} />
      : <input {...props} onChange={event => onChange({ [key]: event.target.value })} />}</label>
  })}</div></>
}

export function CurrencyInput({ value, onCommit, buffered = false, delay = 500, ...inputProps }) {
  const normalizedValue = normalizeCurrencyAmount(value)
  const [draft, setDraft] = useState(normalizedValue)
  const [focused, setFocused] = useState(false)
  const timer = useRef(null)
  const externalValue = useRef(normalizedValue)
  const commitHandler = useRef(onCommit)

  useEffect(() => { commitHandler.current = onCommit }, [onCommit])
  useEffect(() => {
    externalValue.current = normalizedValue
    if (!focused) setDraft(normalizedValue)
  }, [normalizedValue, focused])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = nextValue => {
    window.clearTimeout(timer.current)
    timer.current = null
    if (nextValue === externalValue.current) return
    externalValue.current = nextValue
    commitHandler.current(nextValue)
  }

  return <input
    {...inputProps}
    type="text"
    value={focused ? draft : formatCurrencyAmount(draft)}
    onFocus={event => {
      setFocused(true)
      window.requestAnimationFrame(() => event.target.select())
    }}
    onChange={event => {
      const nextValue = normalizeCurrencyAmount(event.target.value)
      setDraft(nextValue)
      if (!buffered) return commit(nextValue)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => commit(nextValue), delay)
    }}
    onBlur={() => {
      setFocused(false)
      commit(draft)
    }}
  />
}

export function BufferedInput({ value, onCommit, delay = 500, ...inputProps }) {
  const normalizedValue = String(value || '')
  const [draft, setDraft] = useState(normalizedValue)
  const focused = useRef(false)
  const timer = useRef(null)
  const externalValue = useRef(normalizedValue)
  const commitHandler = useRef(onCommit)

  useEffect(() => { commitHandler.current = onCommit }, [onCommit])
  useEffect(() => {
    externalValue.current = normalizedValue
    if (!focused.current) setDraft(normalizedValue)
  }, [normalizedValue])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = nextValue => {
    window.clearTimeout(timer.current)
    timer.current = null
    if (nextValue === externalValue.current) return
    externalValue.current = nextValue
    commitHandler.current(nextValue)
  }

  return <input
    {...inputProps}
    value={draft}
    onFocus={() => { focused.current = true }}
    onChange={event => {
      const nextValue = event.target.value
      setDraft(nextValue)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => commit(nextValue), delay)
    }}
    onBlur={() => {
      focused.current = false
      commit(draft)
    }}
  />
}

export const configurationSnapshotLines = (snapshot, type) => {
  if (!(snapshot || []).length) return ['Sin configuración previa']
  if (type === 'teams') return snapshot.map(item => `${item.label}: ${(item.technicians || []).join(' / ') || 'Sin técnicos'}`)
  if (type === 'vehicles') return snapshot.map(item => `${item.vehicle}: ${item.technician}`)
  return snapshot.map(item => `${item.position}. ${item.technician}`)
}

export function ConfigurationHistoryPanel({ history, type }) {
  const entries = (history || []).filter(entry => entry.type === type).slice().reverse()
  return <details className="configuration-history"><summary><Icon name="history" size={17} />Historial de cambios <span>{entries.length}</span></summary>{entries.length ? <div className="configuration-history-list">{entries.map(entry => <article key={entry.id}><header><b>{prettyReportDateTime(entry.at)}</b><span>{entry.user?.name || 'Administrador'}{entry.user?.email ? ` · ${entry.user.email}` : ''}</span></header><div><section><strong>Antes</strong>{configurationSnapshotLines(entry.before, type).map((line, index) => <p key={`before-${index}`}>{line}</p>)}</section><section><strong>Después</strong>{configurationSnapshotLines(entry.after, type).map((line, index) => <p key={`after-${index}`}>{line}</p>)}</section></div></article>)}</div> : <p className="configuration-history-empty">Todavía no se registraron cambios para este período.</p>}</details>
}

export function ServiceConfirmationButton({ task, day, history = [], persist, onDraftChange, compact = false, disabled = false }) {
  const { can, user } = usePermissions()
  const [open, setOpen] = useState(false)
  const base = historyRecordForTask(task, day, history)
  const current = { ...task, ...base }
  const awaiting = task.awaitingConfirmation === true
  if (!can('planning.confirm') || (base && !canWriteRecord(base, user)) || !task.client || (!base && !onDraftChange) || !canChangeServiceConfirmation(current) || day < currentLocalDate()) return null
  const label = awaiting ? 'Confirmar servicio' : 'Servicio a confirmar'
  const action = async () => {
    if (!can('planning.confirm')) throw new Error('No tenés permiso para cambiar la confirmación.')
    if (onDraftChange) onDraftChange({ awaitingConfirmation: !awaiting })
    else if (base && persist) await persist({ operation: 'service-confirmation', base, awaitingConfirmation: !awaiting })
    else throw new Error('Guardá primero el servicio para cambiar su confirmación.')
  }
  return <><button type="button" className={`service-confirmation-button ${awaiting ? 'awaiting' : ''} ${compact ? 'compact' : 'secondary'}`} disabled={disabled} title={disabled ? 'Guardá los cambios del servicio antes de cambiar la confirmación.' : awaiting ? 'Confirmá el servicio para habilitarlo al técnico según su fecha y horario.' : 'Marcá el servicio como pendiente de confirmación: reserva su horario, pero queda oculto al técnico hasta confirmarlo.'} aria-label={label} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setOpen(true) }}><Icon name={awaiting ? 'check' : 'clock'} size={15} />{!compact && <span>{label}</span>}</button>{open && createPortal(<div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><Confirm title={label} detail={`${awaiting ? 'El servicio quedará visible para los técnicos según su fecha y horario.' : 'El servicio reservará su horario, pero quedará oculto a los técnicos hasta confirmarlo.'}${onDraftChange ? ' El cambio se aplicará al guardar el servicio.' : ''}`} confirmLabel={label} action={action} close={() => setOpen(false)} /></div>, document.body)}</>
}
