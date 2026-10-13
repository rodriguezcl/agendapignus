import React, { useRef, useState } from 'react'
import Icon from './ui/Icon.jsx'
import policy from '../../api/_lib/service-preparation.cjs'
import './service-preparation.css'
export default function ServicePreparationButton({ record, disabled, persist, onNotice }) {
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  if (record?.vehicleControl) return null
  const ready = record?.servicePreparation?.ready === true
  const title = !record?.id ? 'Guardá el servicio antes de marcarlo como listo' : ready ? 'Servicio listo · Preparó ' + (record.servicePreparation.byName || 'Usuario') : record?.servicePreparation?.needsReview ? 'Revisar preparación: el servicio cambió. Marcar servicio como listo' : 'Marcar servicio como listo'
  return <button type="button" className={'service-preparation-button' + (ready ? ' is-ready' : '')} title={title} aria-label={title} aria-pressed={ready} aria-busy={saving} disabled={disabled || saving || !record?.id || !policy.canPrepare(record)} onKeyDown={event => event.stopPropagation()} onClick={async event => {
    event.stopPropagation()
    if (busy.current) return
    busy.current = true; setSaving(true)
    try { await persist({ operation: 'service-preparation', base: record, ready: !ready }); onNotice(ready ? 'Servicio desmarcado como listo.' : 'Servicio listo. Preparación registrada.') }
    catch (error) { onNotice('No se cambió la preparación. ' + error.message) }
    finally { busy.current = false; setSaving(false) }
  }}><Icon name="check" size={14} /></button>
}
