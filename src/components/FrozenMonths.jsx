import { usePermissions } from '../presentation/contexts/permissions-context.jsx'
import React, { useContext, useState } from 'react'

import { FrozenMonthsContext } from '../presentation/contexts/agenda-contexts.js'
import useDiscardGuard from './ui/useDiscardGuard.jsx'
export { FrozenMonthsContext } from '../presentation/contexts/agenda-contexts.js'
export function FrozenMonthsFields({ task, onChange, disabled = false }) {
  const { can } = usePermissions()
  const options = useContext(FrozenMonthsContext)
  const value = Number(task.frozenMonths || 0)
  if (!can('records.financial')) return null
  return <><label className="service-extra-field">Meses congelados<select disabled={disabled || !can('planning.freeze')} required value={task.freezeMonthlyFee === true ? 'yes' : task.freezeMonthlyFee === false ? 'no' : ''} onChange={event => onChange({ freezeMonthlyFee: event.target.value === '' ? null : event.target.value === 'yes', frozenMonths: 0 })}><option value="">Seleccionar</option><option value="no">No</option><option value="yes" disabled={!options.length}>Sí</option></select></label>{task.freezeMonthlyFee && <label className="service-extra-field">Cantidad de meses congelados<select disabled={disabled || !can('planning.freeze')} required value={value || ''} onChange={event => onChange({ frozenMonths: Number(event.target.value) })}><option value="">Seleccionar</option>{value > 0 && !options.includes(value) && <option value={value}>{value} meses (selección anterior)</option>}{options.map(months => <option key={months} value={months}>{months} meses</option>)}</select></label>}</>
}

export function FrozenMonthsSettings({ options, onSave }) {
  const [draft, setDraft] = useState(options.join(', '))
  const [baseline, setBaseline] = useState(options.join(', '))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const guard = useDiscardGuard({ dirty: draft !== baseline, busy, onDiscard: () => setDraft(baseline), title: 'Meses congelados sin guardar' })
  const save = async () => {
    const values = draft.trim() ? draft.split(',').map(value => Number(value.trim())) : []
    if (values.some(value => !Number.isInteger(value) || value < 1 || value > 120)) { setMessage('Ingresá meses enteros entre 1 y 120, separados por comas.'); return }
    setBusy(true); setMessage('')
    try {
      const normalized = [...new Set(values)].sort((a, b) => a - b)
      await onSave(normalized)
      setDraft(normalized.join(', ')); setBaseline(normalized.join(', ')); setMessage('Opciones guardadas.')
    } catch (error) { setMessage(error.message || 'No se pudieron guardar las opciones.') } finally { setBusy(false) }
  }
  return <section className="data-card settings-section frozen-months-settings"><h2>Meses congelados del abono</h2><p>Plazos disponibles para instalaciones de alarma. Quitar un plazo no modifica servicios anteriores.</p><label>Meses habilitados<input disabled={busy} value={draft} placeholder="4, 6" onChange={event => setDraft(event.target.value)} /></label><p>Separá los valores por comas. Dejá vacío para no ofrecer nuevos congelamientos.</p><button title="Guardá la configuración de meses de abono congelado." type="button" className="primary" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar meses disponibles'}</button>{message && <p role="status">{message}</p>}{guard.discardDialog}</section>
}
