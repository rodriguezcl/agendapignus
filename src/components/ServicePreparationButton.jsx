import { canWriteRecord } from '../domain/access/record-scope.mjs'
import { usePermissions } from '../presentation/contexts/permissions-context.jsx'
import React, { useEffect, useRef, useState } from 'react'
import Icon from './ui/Icon.jsx'
import policy from '../../api/_lib/service-preparation.cjs'
import { acknowledgedInteraction, afterInteractionPaint, interactionIsConfirmed } from '../presentation/pending-interaction.mjs'
import './service-preparation.css'
export default function ServicePreparationButton({ record, disabled, persist, onNotice, confirmedRevision }) {
  const { can, user } = usePermissions()
  const [pending, setPending] = useState(null)
  const busy = useRef(false)
  const confirmedReady = record?.servicePreparation?.ready === true
  useEffect(() => {
    if (interactionIsConfirmed(pending, confirmedRevision, confirmedReady === pending?.ready)) {
      busy.current = false
      setPending(null)
    }
  }, [pending, confirmedRevision, confirmedReady])
  if (record?.vehicleControl || !can('planning.ready') || !canWriteRecord(record, user)) return null
  const saving = Boolean(pending)
  const ready = pending?.ready ?? confirmedReady
  const title = pending
    ? pending.phase === 'acknowledged' ? 'Preparación confirmada; actualizando agenda…' : ready ? 'Guardando servicio como listo…' : 'Quitando preparación del servicio…'
    : !record?.id ? 'Guardá el servicio antes de marcarlo como listo' : ready ? 'Servicio listo · Preparó ' + (record.servicePreparation.byName || 'Usuario') : record?.servicePreparation?.needsReview ? 'Revisar preparación: el servicio cambió. Marcar servicio como listo' : 'Marcar servicio como listo'
  return <button type="button" className={'service-preparation-button' + (ready ? ' is-ready' : '')} title={title} aria-label={title} aria-pressed={ready} aria-busy={saving} disabled={disabled || saving || !record?.id || !policy.canPrepare(record)} onKeyDown={event => event.stopPropagation()} onClick={async event => {
    event.stopPropagation()
    if (busy.current || !can('planning.ready')) return
    const preview = { phase: 'pending', ready: !confirmedReady, revision: null }
    busy.current = true
    setPending(preview)
    try {
      await afterInteractionPaint()
      const payload = await persist({ operation: 'service-preparation', base: record, ready: preview.ready })
      setPending(acknowledgedInteraction(preview, payload))
    } catch (error) {
      busy.current = false
      setPending(null)
      onNotice('No se cambió la preparación. ' + (error.message || 'Comprobá la conexión e intentá nuevamente.'))
    }
  }}><Icon name={saving ? 'clock' : 'check'} size={14} /></button>
}
