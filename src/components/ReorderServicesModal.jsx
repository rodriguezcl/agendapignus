import React, { useState } from 'react'
import EditorModal from './ui/EditorModal.jsx'
import { minutesAsTime, timeInMinutes, taskReservationMinutes } from '../domain/agenda/service-scheduling.mjs'

export default function ReorderServicesModal({ tasks, sourceId, day, onClose, onSave }) {
  const [otherId, setOtherId] = useState(tasks.find(task => task.taskId !== sourceId)?.taskId || '')
  const [firstId, setFirstId] = useState(sourceId)
  const now = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [firstTime, setFirstTime] = useState(() => minutesAsTime(Math.max(day === today ? Math.ceil(timeInMinutes(now()) / 15) * 15 : 0, Math.min(...tasks.filter(task => [sourceId, otherId].includes(task.taskId)).map(task => timeInMinutes(task.time))))))
  const [secondTime, setSecondTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pair = tasks.filter(task => [sourceId, otherId].includes(task.taskId))
  const first = pair.find(task => task.taskId === firstId) || pair[0]
  const second = pair.find(task => task !== first)
  const proposed = firstTime ? minutesAsTime(timeInMinutes(firstTime) + taskReservationMinutes(first)) : ''
  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { await onSave([{ taskId: first.taskId, time: firstTime }, { taskId: second.taskId, time: secondTime || proposed }]); onClose() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return <EditorModal active title="Reordenar servicios" eyebrow="AGENDA SEMANAL" onClose={onClose} busy={busy}>
    <p>Se guardarán ambos horarios juntos, sin borrar servicios ni cambiar sus duraciones.</p>
    {tasks.length < 2 && <p role="status">No hay otro servicio pendiente y no iniciado para reordenar en este equipo y día.</p>}
    <label>Otro servicio del mismo equipo<select disabled={busy} value={otherId} onChange={e => { setOtherId(e.target.value); setFirstId(sourceId); setSecondTime('') }}>{tasks.filter(task => task.taskId !== sourceId).map(task => <option key={task.taskId} value={task.taskId}>{task.time} · {task.client}</option>)}</select></label>
    <label>Realizar primero<select disabled={busy} value={first?.taskId} onChange={e => { setFirstId(e.target.value); setSecondTime('') }}>{pair.map(task => <option key={task.taskId} value={task.taskId}>{task.client}</option>)}</select></label>
    <label>{first?.client} · antes {first?.time}<input disabled={busy} type="time" value={firstTime} onChange={e => { setFirstTime(e.target.value); setSecondTime('') }} /></label>
    <label>{second?.client} · antes {second?.time}<input disabled={busy} type="time" value={secondTime || proposed} onChange={e => setSecondTime(e.target.value)} /></label>
    <p>Revisá los nuevos horarios antes de confirmar. El segundo considera la duración y la reserva mínima del primero.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="modal-actions"><button title="Cancelá el cambio de orden sin modificar los horarios." className="secondary" disabled={busy} onClick={onClose}>Cancelar</button><button title="Confirmá el intercambio de horarios de los servicios seleccionados." className="primary" disabled={busy || !second || !firstTime} onClick={save}>{busy ? 'Guardando…' : 'Confirmar nuevos horarios'}</button></div>
  </EditorModal>
}
