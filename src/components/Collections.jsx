import React, { useEffect, useMemo, useState } from 'react'
import ModuleIntroduction from './ModuleIntroduction.jsx'
import EditorModal from './ui/EditorModal.jsx'
import Icon from './ui/Icon.jsx'
import { COLLECTION_PAYMENT_METHODS, collectionBase, collectionConfirmed, collectionMoney, collectionRecords } from '../domain/collections/collections.mjs'
import './collections.css'

const dateLabel = value => value?.split('-').reverse().join('/') || 'Sin fecha'
const timestamp = value => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
const terms = value => `${collectionMoney(value.amount)} · ${value.paymentMethod}`
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function Collections({ history, canManage, onSave, openRequest, onOpenRequestHandled, setNotice }) {
  const [status, setStatus] = useState('pending')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [through, setThrough] = useState('')
  const [page, setPage] = useState(1)
  const [selection, setSelection] = useState(null)
  const records = useMemo(() => collectionRecords(history), [history])
  useEffect(() => {
    if (!openRequest) return
    const record = records.find(item => String(item.id) === String(openRequest.id))
    if (record) { setSelection(record); setStatus('all'); setQuery(''); setFrom(''); setThrough('') }
    else setNotice('La cobranza ya no está disponible. Revisá el listado actualizado.')
    onOpenRequestHandled()
  }, [openRequest, records, onOpenRequestHandled, setNotice])
  useEffect(() => { setPage(1) }, [status, query, from, through])
  const filtered = records.filter(record => (status === 'all' || collectionConfirmed(record) === (status === 'confirmed'))
    && (!from || record.date >= from) && (!through || record.date <= through)
    && normalize(`${record.client} ${record.service} ${(record.technicians || []).join(' ')} ${record.paymentMethod}`).includes(normalize(query)))
  const pending = records.filter(record => !collectionConfirmed(record))
  const confirmed = records.filter(collectionConfirmed)
  const pages = Math.max(1, Math.ceil(filtered.length / 25))
  const currentPage = Math.min(page, pages)
  return <div className="collections-page">
    <ModuleIntroduction><h1>Cobranzas</h1><p>Revisá los pagos de cada servicio y confirmá su recepción.</p></ModuleIntroduction>
    <div className="collections-summary">
      <article><span>Pendiente de pago</span><strong>{collectionMoney(pending.reduce((sum, record) => sum + Number(record.amount), 0))}</strong><small>{pending.length} servicio(s)</small></article>
      <article><span>Pagos confirmados</span><strong>{collectionMoney(confirmed.reduce((sum, record) => sum + Number(record.amount), 0))}</strong><small>{confirmed.length} servicio(s)</small></article>
    </div>
    <p className="collections-help">Seguimiento desde el 14/10/2026. Incluye servicios con monto mayor a cero y forma de pago. El estado del trabajo no confirma el pago.</p>
    <div className="collections-filters">
      <label>Buscar<input type="search" placeholder="Cliente, servicio o forma de pago" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Estado del pago<select value={status} onChange={event => setStatus(event.target.value)}><option value="pending">Pendientes</option><option value="confirmed">Confirmados</option><option value="all">Todos</option></select></label>
      <label>Servicio desde<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Servicio hasta<input type="date" value={through} min={from || undefined} onChange={event => setThrough(event.target.value)} /></label>
    </div>
    <p className="collections-help" role="status">{filtered.length} cobranza(s) en este listado · {collectionMoney(filtered.reduce((sum, record) => sum + Number(record.amount), 0))}</p>
    <div className="collections-table-wrap"><table className="collections-table">
      <thead><tr>{['Fecha del servicio', 'Cliente y servicio', 'Monto', 'Forma de pago', 'Estado del pago', 'Acciones'].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{filtered.slice((currentPage - 1) * 25, currentPage * 25).map(record => <tr key={record.id}>
        <td data-label="Fecha del servicio">{dateLabel(record.date)}<small>{record.time || 'Sin horario'}</small></td>
        <td data-label="Cliente y servicio"><strong>{record.client}</strong><small>{record.service}</small><small>{record.status} · {(record.technicians || []).join(' / ') || 'Sin técnicos asignados'}</small></td>
        <td data-label="Monto"><strong>{collectionMoney(record.amount)}</strong></td>
        <td data-label="Forma de pago">{record.paymentMethod}</td>
        <td data-label="Estado del pago"><span className={`collection-status ${collectionConfirmed(record) ? 'confirmed' : ''}`}>{collectionConfirmed(record) ? 'Confirmado' : 'Pendiente de pago'}</span>{record.collection?.confirmedAt && <small>{timestamp(record.collection.confirmedAt)}</small>}</td>
        <td data-label="Acciones"><button type="button" className="secondary" aria-label={`${canManage ? 'Gestionar' : 'Ver'} cobranza de ${record.client}`} onClick={() => setSelection(record)}><Icon name={canManage ? 'edit' : 'eye'} />{canManage ? 'Gestionar' : 'Ver detalle'}</button></td>
      </tr>)}</tbody>
    </table>{!filtered.length && <p className="empty-state">No hay cobranzas que coincidan con estos filtros.</p>}</div>
    {pages > 1 && <nav className="collections-pagination" aria-label="Paginación de cobranzas"><button className="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage} de {pages}</span><button className="secondary" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
    {selection && <CollectionEditor key={selection.id} record={selection} canManage={canManage} onSave={onSave} close={() => setSelection(null)} onSaved={message => { setSelection(null); setNotice(message) }} />}
  </div>
}

function CollectionEditor({ record, canManage, onSave, close, onSaved }) {
  const [amount, setAmount] = useState(String(record.amount))
  const [method, setMethod] = useState(record.paymentMethod)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changed = Number(amount) !== Number(record.amount) || method !== record.paymentMethod
  const save = async event => {
    event.preventDefault()
    if (busy) return
    const action = event.nativeEvent.submitter?.value || 'correct'
    setBusy(true); setError('')
    try {
      await onSave({ recordId: record.id, base: collectionBase(record), action, amount, paymentMethod: method, note })
      onSaved(action === 'confirm' ? 'Pago confirmado. La notificación de cobranza fue resuelta.' : 'Corrección guardada en el historial de la cobranza.')
    } catch (failure) { setError(failure.message || 'No se pudo guardar. Intentá nuevamente.') }
    finally { setBusy(false) }
  }
  return <div className="collections-editor"><EditorModal active title={canManage ? 'Gestionar cobranza' : 'Detalle de cobranza'} eyebrow={collectionConfirmed(record) ? 'PAGO CONFIRMADO' : 'PENDIENTE DE PAGO'} onClose={close} dirty={canManage && (changed || Boolean(note))} busy={busy}>
    <p><strong>{record.client}</strong><br />{record.service} · {dateLabel(record.date)}{record.serviceJourney && <><br />Cobranza compartida entre las {record.serviceJourney.total} jornadas del servicio.</>}</p>
    {record.collection?.confirmedAt && <p>Confirmado por {record.collection.confirmedBy?.name} · {timestamp(record.collection.confirmedAt)}</p>}
    {canManage ? <form onSubmit={save}><fieldset disabled={busy}>
      <div className="collection-fields">
        <label>Monto {collectionConfirmed(record) ? 'cobrado' : 'a cobrar'} ($)<input required type="number" min="0.01" max="999999999.99" step="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>Forma de pago<select required value={method} onChange={event => setMethod(event.target.value)}>{!COLLECTION_PAYMENT_METHODS.includes(method) && <option value={method} disabled>{method || 'Seleccionar'}</option>}{COLLECTION_PAYMENT_METHODS.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <label>Observación (opcional)<textarea maxLength={1000} rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="Por ejemplo: transfirió en lugar de pagar en efectivo" /></label>
      <p className="collections-help">{collectionConfirmed(record) ? 'La rectificación conserva el pago confirmado y registra los valores anteriores.' : 'Guardar una corrección mantiene el pago pendiente. Confirmá sólo después de verificar que se recibió el dinero.'}</p>
      {error && <p className="collection-error" role="alert">{error}</p>}
      <div className="collection-actions"><button className="secondary" type="submit" value="correct" disabled={!changed || busy}>Guardar corrección</button>{!collectionConfirmed(record) && <button className="primary" type="submit" value="confirm" disabled={busy || !COLLECTION_PAYMENT_METHODS.includes(method)}><Icon name="check" />{busy ? 'Guardando…' : 'Confirmar pago'}</button>}</div>
    </fieldset></form> : <p>{terms(record)}</p>}
    <section className="collection-trace" aria-label="Historial de la cobranza"><h3>Historial de la cobranza</h3>
      <p>Datos iniciales: {terms(record.collection?.original || record)}</p>
      {record.collection?.events?.length ? <ol>{[...record.collection.events].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><strong>{entry.action === 'confirm' ? 'Pago confirmado' : 'Datos rectificados'}</strong><small>{timestamp(entry.at)} · {entry.actor.name}</small><p>{terms(entry.before)} → {terms(entry.after)}</p>{entry.note && <p>{entry.note}</p>}</li>)}</ol> : <p className="collections-help">Todavía no se registraron gestiones de esta cobranza.</p>}
    </section>
  </EditorModal></div>
}
