import React, { useState } from 'react'
import Icon from './ui/Icon.jsx'
import { rescheduleSlots } from '../domain/agenda/reschedule-slots.mjs'
import { requiresDifferentRescheduleDay } from '../domain/history/history-edit-policy.mjs'
import { durationLabel } from '../domain/agenda/duration-label.mjs'
import './history-reschedule-modal.css'

export default function HistoryRescheduleModal({ record, estimatedMinutes, scheduling, minimumDate, blocked, onCancel, onSaved }) {
  const [day, setDay] = useState('')
  const [selection, setSelection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const invalidDay = day && (day < minimumDate || (day === record.date && requiresDifferentRescheduleDay(record)))
  const teams = day && !invalidDay ? rescheduleSlots(day, { ...record, estimatedMinutes }, scheduling?.assignedTeamsForDate?.(day) || [], scheduling?.teamsForDate || (() => [])) : []
  const selectedTeam = teams.find(team => String(team.teamId) === String(selection?.teamId) && team.slots.some(slot => slot.time === selection?.time))
  const busy = blocked || saving
  const save = async () => {
    if (busy || !selectedTeam) return
    setSaving(true); setError('')
    try { await scheduling.save(record, day, selection.teamId, selection.time); onSaved() }
    catch (failure) { setError(failure.message || 'No se pudo reprogramar. Elegí un horario disponible e intentá nuevamente.'); setSelection(null) }
    finally { setSaving(false) }
  }
  return <div className="modal-layer"><section className="modal history-reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
    <button type="button" className="close-modal" aria-label="Volver al detalle" title="Volvé al detalle sin reprogramar." disabled={saving} onClick={onCancel}><Icon name="close" /></button>
    <p className="eyebrow">HISTORIAL · REPROGRAMACIÓN</p><h2 id="reschedule-title">Reprogramar servicio</h2><p>{record.client}</p>
    <div className="reschedule-overview"><div><strong>{record.service}</strong><p>Duración estimada: {durationLabel(estimatedMinutes)}</p></div><label>Reprogramar para<input type="date" min={minimumDate} value={day} disabled={busy} onChange={event => { setDay(event.target.value); setSelection(null); setError('') }} /></label></div>
    <h3>Disponibilidad por equipo</h3><p>Elegí un horario de inicio. Las opciones contemplan la duración completa y la reserva del servicio.</p>
    {blocked && <p role="alert" className="field-error">El servicio cambió desde otra sesión. Volvé al detalle y revisá la versión actual.</p>}
    {invalidDay && <p role="alert" className="field-error">Elegí una fecha desde hoy, distinta del día original para una reprogramación pendiente.</p>}
    {!day && <p className="reschedule-empty">Seleccioná un día para consultar los horarios disponibles.</p>}
    {day && !invalidDay && !teams.length && <p className="reschedule-empty">No hay equipos habilitados con técnicos asignados para este día.</p>}
    <div className="reschedule-team-list">{teams.map(team => <article className="reschedule-team" key={team.teamId}><header><strong>{team.label}</strong><small>{team.members?.join(' / ')}</small></header>{team.slots.length ? <div className="reschedule-slots">{team.slots.map(slot => <button type="button" key={slot.time} className={selectedTeam?.teamId === team.teamId && selection?.time === slot.time ? 'primary' : 'secondary'} aria-pressed={selectedTeam?.teamId === team.teamId && selection?.time === slot.time} title={`${team.label}: ${slot.time}–${slot.end}`} disabled={busy} onClick={() => { setSelection({ teamId: team.teamId, ...slot }); setError('') }}>{slot.time}</button>)}</div> : <p>Sin disponibilidad para este servicio.</p>}</article>)}</div>
    {selectedTeam && <div className="reschedule-selection" role="status"><strong>{selectedTeam.label} · {day.split('-').reverse().join('/')} · {selection.time}–{selection.end}</strong><p>Selección pendiente de confirmar.</p></div>}
    {selection && !selectedTeam && <p role="alert" className="field-error">Ese horario ya no está disponible. Elegí otra opción.</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="reschedule-footer"><button type="button" className="secondary" disabled={saving} onClick={onCancel}>Cancelar</button><button type="button" className="primary" disabled={busy || !selectedTeam} onClick={save}>{saving ? 'Guardando…' : 'Confirmar reprogramación'}</button></div>
  </section></div>
}
