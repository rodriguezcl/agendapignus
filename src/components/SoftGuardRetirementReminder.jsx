import React, { useRef, useState } from 'react'
import { usePermissions } from '../presentation/contexts/permissions-context.jsx'
import { previousSubscriberAccount } from '../domain/customers/customer-provenance.mjs'
import { softguardRetirementPending, softguardRetirementResolution } from '../domain/customers/softguard-retirement.mjs'
import { softguardRetirementRepository } from '../infrastructure/repositories/softguard-retirement-repository.mjs'
import Icon from './ui/Icon.jsx'
import './softguard-retirement-reminder.css'

const timestamp = value => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : ''
}

export default function SoftGuardRetirementReminder({ customer, onResolved, onBusyChange, showHeading = true, onResolve = softguardRetirementRepository.resolve }) {
  const { can } = usePermissions()
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const saving = useRef(false)
  const account = previousSubscriberAccount(customer || {})
  const pending = softguardRetirementPending(customer)
  const resolution = softguardRetirementResolution(customer)
  const canResolve = can('accounts.view') && can('customers.softguard.resolve')
  if (!account || !can('accounts.view') || (!pending && !resolution)) return null

  const resolve = async () => {
    if (saving.current || !canResolve || !verified || !pending) return
    saving.current = true
    setBusy(true); onBusyChange?.(true); setError('')
    let persisted = saved
    try {
      if (!persisted) {
        await onResolve(customer)
        persisted = true
        setSaved(true)
      }
      if (typeof globalThis.__pignusRefreshRemoteState !== 'function') throw new Error('No se pudo actualizar la información. Volvé a intentar.')
      await globalThis.__pignusRefreshRemoteState()
      onResolved?.()
    } catch (failure) {
      setError(persisted
        ? 'La baja quedó registrada, pero no se pudo actualizar la información. Reintentá la actualización.'
        : failure.message || 'No se pudo registrar la baja. Intentá nuevamente.')
    } finally {
      saving.current = false
      setBusy(false); onBusyChange?.(false)
    }
  }

  return <section className="softguard-retirement-reminder" data-state={pending ? 'pending' : 'resolved'} aria-label="Baja en SoftGuard" aria-busy={busy || undefined}>
    {showHeading && <div className="softguard-retirement-heading"><Icon name={pending ? 'alert' : 'check'} size={19} /><strong>{pending ? 'Baja pendiente en SoftGuard' : 'Baja registrada en SoftGuard'}</strong></div>}
    <p className="softguard-retirement-customer"><strong>{customer.name}</strong> · {customer.account}</p>
    <p>Cuenta PIG anterior: <b>{account}</b></p>
    {pending ? <>
      <p>El retiro del equipo no da de baja la cuenta en SoftGuard. Este aviso permanece hasta registrar que esa gestión ya fue realizada.</p>
      {canResolve ? <div className="softguard-retirement-action">
        <label className="softguard-retirement-verification"><input type="checkbox" checked={verified} disabled={busy || saved} onChange={event => { setVerified(event.target.checked); setError('') }} /><span>Verifiqué que la cuenta {account} fue dada de baja en SoftGuard.</span></label>
        <button type="button" className="primary softguard-retirement-submit" title={saved ? 'Actualizá la información para consultar la baja que ya quedó registrada.' : 'Registrá que verificaste la baja en SoftGuard y resolvé el recordatorio para todos los usuarios.'} disabled={!verified || busy} onClick={resolve}>{busy ? saved ? 'Actualizando…' : 'Guardando…' : saved ? 'Reintentar actualización' : 'Registrar baja realizada en SoftGuard'}</button>
      </div> : <p className="softguard-retirement-readonly">Tu rol puede consultar este aviso. Registrar la baja realizada requiere el permiso correspondiente.</p>}
    </> : <p className="softguard-retirement-resolution" role="status">Registrada por {resolution?.completedByName || 'Usuario'}{timestamp(resolution?.completedAt) && <> · <time dateTime={resolution.completedAt}>{timestamp(resolution.completedAt)}</time></>}</p>}
    {error && <p className="softguard-retirement-error" role="alert">{error}</p>}
  </section>
}
