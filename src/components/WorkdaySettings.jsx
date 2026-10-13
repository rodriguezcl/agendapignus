import React, { useState } from 'react'
import workday from '../../api/_lib/workday.cjs'

export default function WorkdaySettings({ weekly, persistWeeklyConfiguration, setNotice }) {
  const [scope, setScope] = useState('weekday')
  const [weekday, setWeekday] = useState('1')
  const [date, setDate] = useState('')
  const [teamId, setTeamId] = useState('')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const config = weekly?._workday || {}
  const key = scope === 'weekday' ? weekday : `${date}${teamId ? `|${teamId}` : ''}`
  const collection = scope === 'weekday' ? 'weekdays' : 'exceptions'
  const teams = weekly?.[date]?.teams || weekly?._monthlyTeams?.[date.slice(0, 7)]?.teams || []
  const current = draft || (scope === 'weekday' ? config.weekdays?.[weekday] || workday.defaults(Number(weekday)) : workday.workdayForDate(date, weekly, teamId) || workday.defaults(1))
  const changeScope = action => { action(); setDraft(null) }
  const save = async (remove = false) => {
    if (scope !== 'weekday' && (!date || new Date(`${date}T12:00:00`).getDay() === 0)) return setNotice('Elegí una fecha laboral de lunes a sábado.')
    setSaving(true)
    try {
      await persistWeeklyConfiguration(snapshot => {
        const old = snapshot.agenda?.weekly || {}
        const next = { ...(old._workday || {}), [collection]: { ...old._workday?.[collection] } }
        if (remove) delete next[collection][key]
        else next[collection][key] = { ...current }
        workday.validateWorkday(next)
        return { ...snapshot, agenda: { ...snapshot.agenda, weekly: { ...old, _workday: next } } }
      })
      setDraft(null)
      setNotice('Jornada laboral guardada. Los servicios existentes conservan sus horarios; revisá los que queden fuera de la nueva jornada.')
    } catch (error) { setNotice(`No se guardó la jornada. ${error.message}`) }
    finally { setSaving(false) }
  }
  return <section className="data-card settings-section workday-settings"><h2>Jornada laboral</h2><p>El ingreso habitual es a las 08:00 y la disponibilidad para servicios empieza a las 08:30, después de la preparación. Podés agendar a las 08:30, 08:45, 09:00 o más tarde.</p><p>Las excepciones del equipo tienen prioridad sobre las del día. Los feriados y las guardias conservan sus restricciones; los viernes de 16:00 a 20:00 se reservan para adelantar guardias.</p>
    {Object.keys(config.exceptions || {}).length > 0 && <details><summary>Excepciones guardadas</summary><ul>{Object.entries(config.exceptions).sort(([a], [b]) => a.localeCompare(b)).map(([id, row]) => { const [day, team] = id.split('|'); const sources = weekly?.[day]?.teams || weekly?._monthlyTeams?.[day.slice(0, 7)]?.teams || []; const index = sources.findIndex(item => String(item.teamId) === team); return <li key={id}><button type="button" className="secondary" disabled={saving} title="Revisá o modificá esta excepción de jornada." onClick={() => changeScope(() => { setScope('date'); setDate(day); setTeamId(team || '') })}>{day} · {team ? sources[index]?.label || (index >= 0 ? `Equipo ${index + 1}` : 'Equipo no disponible') : 'Todos los equipos'} · {row.bookable}–{row.end}</button></li> })}</ul></details>}
    <form onSubmit={event => { event.preventDefault(); save() }}><fieldset disabled={saving}><div className="monthly-time-grid">
      <label>Aplicar a<select value={scope} onChange={event => changeScope(() => { setScope(event.target.value); setTeamId('') })}><option value="weekday">Jornada habitual</option><option value="date">Excepción por día o equipo</option></select></label>
      {scope === 'weekday' ? <label>Día de la semana<select value={weekday} onChange={event => changeScope(() => setWeekday(event.target.value))}>{['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label> : <><label>Fecha<input required type="date" value={date} onChange={event => changeScope(() => { setDate(event.target.value); setTeamId('') })} /></label><label>Equipo<select value={teamId} onChange={event => changeScope(() => setTeamId(event.target.value))}><option value="">Todos los equipos del día</option>{teams.filter(team => team.teamId).map((team, index) => <option key={team.teamId} value={team.teamId}>{team.label || `Equipo ${index + 1}`} · {(team.members || []).join(' · ')}</option>)}</select></label></>}
      {[['start', 'Ingreso'], ['bookable', 'Inicio de disponibilidad'], ['end', 'Fin de jornada'], ['breakStart', 'Inicio del descanso'], ['breakEnd', 'Fin del descanso']].map(([field, label]) => <label key={field}>{label}<input required type="time" value={current[field]} onChange={event => setDraft({ ...current, [field]: event.target.value })} /></label>)}
    </div><div className="modal-actions"><button className="primary" title="Guardá la jornada laboral y recalculá las franjas disponibles." type="submit">{saving ? 'Guardando…' : 'Guardar jornada'}</button>{config[collection]?.[key] && <button className="secondary" title="Quitá esta configuración para volver a utilizar la jornada heredada." type="button" onClick={() => save(true)}>Restablecer jornada</button>}</div></fieldset></form>
  </section>
}
