import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './ui/Icon.jsx'
import { durationLabel } from '../domain/agenda/duration-label.mjs'
import { availableRescheduleTeams } from '../domain/agenda/reschedule-availability.mjs'
import { isMonthlyMeeting } from '../domain/agenda/service-scheduling.mjs'
import './service-journeys.css'
import { journeyLabel } from '../domain/agenda/journey-progress.mjs'
export { journeyLabel, journeyReportType } from '../domain/agenda/journey-progress.mjs'

export const ServiceJourneysContext = createContext(null)

export function JourneyIdentityField({ record, customer = false, children }) {
  const context = useContext(ServiceJourneysContext)
  const locked = record.serviceJourney && (context?.history || [record]).some(item => item.serviceJourney?.id === record.serviceJourney.id && (item.startedAt || item.technicalStatus || item.technicalReportedAt || item.journeyClosedAt || ['Avance registrado', 'Completado'].includes(item.status)))
  if (locked && !(customer && record.subscriberReservation)) return <label>{customer ? 'Cliente o cuenta' : 'Tipo de servicio'}<input readOnly value={(customer ? record.client : record.service) || ''} /><small>Protegido: una jornada ya tiene trabajo registrado.</small></label>
  return <div>{children}{record.serviceJourney && <small>{record.subscriberReservation && customer ? 'La vinculación PIG se aplica a todas las jornadas y conserva los informes.' : 'El cambio se aplica a todas las jornadas del servicio.'}</small>}</div>
}

export function JourneyHistory({ record }) {
  const context = useContext(ServiceJourneysContext)
  if (!record?.serviceJourney) return null
  const visits = (context?.history || [record]).filter(item => item.serviceJourney?.id === record.serviceJourney.id).sort((a,b) => a.serviceJourney.index - b.serviceJourney.index)
  return <section className="journey-history"><h3>Planificación original e informes</h3>{visits.map(item => <article key={item.id}><b>Jornada {item.serviceJourney.index} de {item.serviceJourney.total} · {item.date.split('-').reverse().join('/')} · {item.time}</b><p>{item.team} · {item.technicians?.join(' / ')} · {durationLabel(item.estimatedMinutes)}</p><p>{item.status}</p>{item.technicalObservation && <p className="journey-report">{item.technicalReportedByName || 'Técnico'}: {item.technicalObservation}</p>}</article>)}</section>
}

export function ServiceJourneys({ record, disabled = false, compact = false, action = false }) {
  const context = useContext(ServiceJourneysContext)
  const titleId = useId()
  const dialogRef = useRef(null)
  const openerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [visits, setVisits] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const guard = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    dialogRef.current?.focus()
    return () => { window.removeEventListener('beforeunload', guard); openerRef.current?.focus() }
  }, [open])
  useEffect(() => {
    if (open) (dialogRef.current?.querySelector('[data-keep-editing]') || dialogRef.current)?.focus()
  }, [open, confirmDiscard])
  const close = () => { if (!saving) setConfirmDiscard(true) }
  const keepEditing = () => setConfirmDiscard(false)
  const discard = () => { setConfirmDiscard(false); setOpen(false); setVisits([]); setError('') }
  const dialogKeyDown = event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); if (confirmDiscard) keepEditing(); else close(); return }
    if (event.key !== 'Tab') return
    const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])].filter(control => !control.closest('[hidden]'))
    const first = controls[0], last = controls.at(-1)
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  if (!record) return null
  if (record.serviceJourney) {
    const label = journeyLabel(record, context?.history)
    return compact || action || !label ? null : <small className="journey-label">{label}</small>
  }
  if (!context?.enabled || record.vehicleControl || isMonthlyMeeting(record) || record.startedAt || record.technicalStatus || record.status !== 'Pendiente' || record.date < context.today) return null
  const change = (index, patch) => setVisits(previous => previous.map((item, position) => position === index ? { ...item, ...patch } : item))
  const add = () => setVisits(previous => [...previous, { date: '', time: '', teamId: '', estimatedMinutes: 60 }])
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError('')
    try { await context.save(record, visits); setOpen(false) }
    catch (failure) { setError(failure.message || 'No se guardaron las jornadas.') }
    finally { setSaving(false) }
  }
  return <><button ref={openerRef} type="button" disabled={disabled} aria-label="Planificar varias jornadas" title={disabled ? 'Guardá los cambios antes de planificar las jornadas.' : 'Planificar varias jornadas'} className={compact ? 'weekly-task-move journey-plan-compact' : action ? 'icon-btn daily-journey-button' : 'link-button journey-plan-button'} onKeyDown={event => event.stopPropagation()} onClick={event => {
    event.stopPropagation(); setVisits([{ date: record.date, time: record.time, teamId: record.teamId, estimatedMinutes: record.estimatedMinutes }, { date: '', time: '', teamId: '', estimatedMinutes: 60 }]); setError(''); setConfirmDiscard(false); setOpen(true)
  }}>{compact ? <Icon name="calendar" size={14} /> : action ? 'Jornadas' : 'Planificar varias jornadas'}</button>{open && createPortal(<div className="modal-layer journey-layer" onClick={event => event.stopPropagation()} onKeyDown={dialogKeyDown}><section ref={dialogRef} tabIndex={-1} className="modal journey-modal" role={confirmDiscard ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={titleId}><h2 id={titleId}>{confirmDiscard ? "Planificación sin guardar" : "Servicio en varias jornadas"}</h2>{confirmDiscard && <><p>Los cambios de las jornadas todavía no se guardaron. Podés seguir editando o descartar esta planificación.</p><div className="modal-actions"><button data-keep-editing type="button" className="secondary" onClick={keepEditing}>Seguir editando</button><button type="button" className="danger-button" onClick={discard}>Descartar planificación</button></div></>}<p hidden={confirmDiscard}>{record.client}</p><p hidden={confirmDiscard}>La primera visita conserva su fecha, hora y equipo. Ajustá su duración y reservá las siguientes. Se guardan todas juntas; si hay un conflicto no se guarda ninguna.</p><form hidden={confirmDiscard} onSubmit={submit}><fieldset disabled={saving}>{visits.map((visit,index) => {
    const choices = visit.date && visit.time ? (context.availableTeams ? context.availableTeams(visit.date, visit.time, { ...record, estimatedMinutes: visit.estimatedMinutes }) : availableRescheduleTeams(context.teamsForDate(visit.date), { ...record, estimatedMinutes: visit.estimatedMinutes }, visit.date, visit.time)) : []
    return <section className="journey-row" key={index}><b>Jornada {index + 1}</b><label>Día<input type="date" required min={index ? visits[index - 1].date || context.today : context.today} value={visit.date} disabled={!index} onChange={event => change(index,{date:event.target.value,teamId:''})} /></label><label>Hora<input type="time" required value={visit.time} disabled={!index} onChange={event => change(index,{time:event.target.value,teamId:''})} /></label><label>Tiempo estimado<div className="journey-duration"><input aria-label={`Horas jornada ${index+1}`} type="number" min="0" max="12" required value={Math.floor(visit.estimatedMinutes/60)} onChange={event => change(index,{estimatedMinutes:Number(event.target.value)*60+visit.estimatedMinutes%60,...(index?{teamId:''}:{})})} /><span>h</span><select aria-label={`Minutos jornada ${index+1}`} value={visit.estimatedMinutes%60} onChange={event => change(index,{estimatedMinutes:Math.floor(visit.estimatedMinutes/60)*60+Number(event.target.value),...(index?{teamId:''}:{})})}>{[0,15,30,45].map(value=><option key={value} value={value}>{value}</option>)}</select><span>min</span></div></label><label>Equipo<select required value={visit.teamId} disabled={!index || !visit.date || !visit.time} onChange={event=>change(index,{teamId:event.target.value})}>{!index ? <option value={record.teamId}>{record.team} · {record.technicians?.join(' / ')}</option> : <><option value="">{visit.date && visit.time ? 'Seleccionar equipo disponible' : 'Completá día y hora'}</option>{choices.map(team=><option key={team.teamId} value={team.teamId}>{team.label} · {team.members?.join(' / ')}</option>)}</>}</select></label>{index>0 && visit.date && visit.time && !choices.length && <p role="status">No hay equipos disponibles para ese horario y duración.</p>}{index===visits.length-1 && index>1 && <button type="button" className="secondary" onClick={()=>setVisits(previous=>previous.slice(0,-1))}>Quitar jornada</button>}</section>
  })}{visits.length<20 && <button type="button" className="secondary" onClick={add}>Agregar jornada</button>}<p>Total estimado: {durationLabel(visits.reduce((sum,visit)=>sum+Number(visit.estimatedMinutes),0))}</p>{error && <p className="field-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button className="primary" type="submit">{saving?'Guardando…':'Confirmar todas las jornadas'}</button></div></fieldset></form></section></div>,document.body)}</>
}
