import React, { useState } from 'react'
import EditorModal from './ui/EditorModal.jsx'
import { usePermissions } from '../presentation/contexts/permissions-context.jsx'
import { currentLocalDate } from '../presentation/formatting.mjs'
import { defaultServiceTimesForDate, monthlyDefaultTimePeriods } from '../features/agenda/application/agenda-model.mjs'
import hoursPolicy from '../../api/_lib/monthly-hours.cjs'

const hoursFields = config => JSON.stringify({ defaultTimes: config?.defaultTimes, defaultTimePeriods: config?.defaultTimePeriods })
export default function MonthlyHoursSettings({ month, weekly, persistWeeklyConfiguration, onClose, setNotice }) {
  const { can } = usePermissions()
  const today = currentLocalDate()
  const editable = can('weekly.monthlyHours.manage') && month >= today.slice(0, 7)
  const config = weekly?._monthlyTeams?.[month] || {}
  const [baseline] = useState(() => hoursFields(config))
  const [periods, setPeriods] = useState(() => monthlyDefaultTimePeriods(config, month))
  const [from, setFrom] = useState(() => month === today.slice(0, 7) ? today : `${month}-01`)
  const [times, setTimes] = useState(() => defaultServiceTimesForDate(from, weekly))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!can('weekly.monthlyHours.read')) return null
  const addPeriod = event => {
    event.preventDefault()
    if (!editable || saving) return
    if (from < today) { setError('Elegí una fecha actual o futura.'); return }
    const next = [...periods.filter(period => period.from !== from), { from, times }].sort((a, b) => a.from.localeCompare(b.from))
    try { hoursPolicy.validateMonthlyHours(month, { defaultTimePeriods: next }) }
    catch (validationError) { setError(validationError.message); return }
    setPeriods(next); setDirty(true); setError('')
  }
  const save = async () => {
    if (!editable || saving || !dirty) return
    setSaving(true); setError('')
    try {
      hoursPolicy.validateMonthlyHours(month, { defaultTimePeriods: periods })
      await persistWeeklyConfiguration(snapshot => {
        const oldWeekly = snapshot.agenda?.weekly || {}
        const latest = oldWeekly._monthlyTeams?.[month] || {}
        if (hoursFields(latest) !== baseline) throw new Error('Otra persona modificó los horarios de este mes. Cerrá y volvé a abrir para revisar la versión actual.')
        const { defaultTimes: previousDefaults, ...rest } = latest
        const nextMonth = { ...rest, defaultTimePeriods: periods }
        return { ...snapshot, agenda: { ...snapshot.agenda, weekly: { ...oldWeekly, _monthlyTeams: { ...oldWeekly._monthlyTeams, [month]: nextMonth } } } }
      })
      setNotice('Los horarios del mes se guardaron correctamente.'); onClose()
    } catch (saveError) { setError(saveError.message || 'No se pudieron guardar los horarios.') }
    finally { setSaving(false) }
  }
  return <EditorModal active title={`Horarios del mes · ${month}`} eyebrow="PLANIFICACIÓN" onClose={onClose} busy={saving} dirty={dirty}>
    <p>Horarios sugeridos para las franjas vacías. Los servicios que ya tienen un horario conservan su programación.</p>
    {periods.length ? <ul>{periods.map(period => <li key={period.from}>
      Desde {period.from}: {period.times.join(' y ')}
      {editable && period.from >= today && <button type="button" className="secondary" disabled={saving} title={`Quitá los horarios que comienzan el ${period.from}.`} onClick={() => { setPeriods(previous => previous.filter(item => item.from !== period.from)); setDirty(true) }}>Quitar período</button>}
    </li>)}</ul> : <p>Se utilizan los horarios predeterminados del sistema.</p>}
    {editable && <form onSubmit={addPeriod}>
      <div className="monthly-time-grid">
        <label>Aplicar desde<input type="date" required min={month === today.slice(0, 7) ? today : `${month}-01`} value={from} onChange={event => setFrom(event.target.value)} disabled={saving} /></label>
        {times.map((time, index) => <label key={index}>{index === 0 ? 'Primera franja' : 'Segunda franja'}<input type="time" required value={time} disabled={saving} onChange={event => setTimes(previous => previous.map((value, position) => position === index ? event.target.value : value))} /></label>)}
      </div>
      <button type="submit" className="secondary" disabled={saving} title="Agregá este período al borrador de horarios.">Agregar o actualizar período</button>
    </form>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {editable && <div className="modal-actions"><button type="button" className="primary" onClick={save} disabled={saving || !dirty} title="Guardá los períodos de horarios de este mes.">{saving ? 'Guardando…' : 'Guardar horarios'}</button></div>}
  </EditorModal>
}
