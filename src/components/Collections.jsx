import { useActionPermissions } from '../presentation/hooks/useActionPermissions.mjs'
import { usePermissions } from '../presentation/contexts/permissions-context.jsx'
import { canReadRecord, canWriteRecord } from '../domain/access/record-scope.mjs'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import ModuleIntroduction from './ModuleIntroduction.jsx'
import EditorModal from './ui/EditorModal.jsx'
import Icon from './ui/Icon.jsx'
import { COLLECTION_PAYMENT_METHODS, collectionBase, collectionConfirmed, collectionMoney, collectionRecords, collectionServiceResolver } from '../domain/collections/collections.mjs'
import './collections.css'
import { parseCollectionAmount, displayCollectionAmount } from '../domain/collections/collection-amount.mjs'
import CollectionReceiptField from './CollectionReceiptField.jsx'

const dateLabel = value => value?.split('-').reverse().join('/') || 'Sin fecha'
const timestamp = value => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
const terms = value => `${collectionMoney(value.amount)} · ${value.paymentMethod}`
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function Collections({ history, customers = [], canManage, onSave, openRequest, onOpenRequestHandled, setNotice }) {
  const { can, granular, user } = useActionPermissions()
  const { can: hasPermission } = usePermissions()
  canManage = granular ? ['collections.confirm', 'collections.amount', 'collections.method'].some(key => can(key)) : canManage
  const canView = hasPermission('collections.view') && hasPermission('records.financial')
  const [status, setStatus] = useState('pending')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [through, setThrough] = useState('')
  const [page, setPage] = useState(1)
  const [selection, setSelection] = useState(null)
  const resolveService = useMemo(() => collectionServiceResolver(history), [history])
  const records = useMemo(() => collectionRecords(history, resolveService).filter(record =>
    canReadRecord(record, user, customers) && canReadRecord(resolveService(record) || record, user, customers)
  ), [history, resolveService, user, customers])
  const schedule = record => resolveService(record) || record
  const mayManage = record => canManage && canWriteRecord(record, user, customers) && canWriteRecord(schedule(record), user, customers)
  useEffect(() => {
    if (!openRequest) return
    if (openRequest.from && openRequest.through && !openRequest.id) {
      setSelection(null)
      setStatus('all')
      setQuery('')
      setFrom(openRequest.from)
      setThrough(openRequest.through)
      onOpenRequestHandled()
      return
    }
    const record = records.find(item => String(item.id) === String(openRequest.id))
    if (record) { setSelection(record); setStatus('all'); setQuery(''); setFrom(''); setThrough('') }
    else setNotice('La cobranza ya no está disponible. Revisá el listado actualizado.')
    onOpenRequestHandled()
  }, [openRequest, records, onOpenRequestHandled, setNotice])
  useEffect(() => { setPage(1) }, [status, query, from, through])
  const filtered = records.filter(record => (status === 'all' || collectionConfirmed(record) === (status === 'confirmed'))
    && (!from || schedule(record).date >= from) && (!through || schedule(record).date <= through)
    && normalize(`${record.client} ${record.service} ${(record.technicians || []).join(' ')} ${record.paymentMethod}`).includes(normalize(query)))
  const pending = records.filter(record => !collectionConfirmed(record))
  const confirmed = records.filter(collectionConfirmed)
  const pages = Math.max(1, Math.ceil(filtered.length / 25))
  const currentPage = Math.min(page, pages)
  const selectedVisibleRecord = selection && records.find(record => String(record.id) === String(selection.id))
  if (!canView) return <div className="collections-page"><ModuleIntroduction><h1>Cobranzas</h1><p>La consulta de cobranzas requiere acceso al módulo y permiso para ver importes y medios de pago.</p></ModuleIntroduction></div>
  return <div className="collections-page">
    <ModuleIntroduction><h1>Cobranzas</h1><p>Revisá los pagos de cada servicio y confirmá su recepción.</p></ModuleIntroduction>
    <div className="collections-summary">
      <article><span>Pendiente de pago</span><strong>{collectionMoney(pending.reduce((sum, record) => sum + Number(record.amount), 0))}</strong><small>{pending.length} servicio(s){(from || through) && ' · todos los períodos'}</small></article>
      <article><span>Pagos confirmados</span><strong>{collectionMoney(confirmed.reduce((sum, record) => sum + Number(record.amount), 0))}</strong><small>{confirmed.length} servicio(s){(from || through) && ' · todos los períodos'}</small></article>
    </div>
    <p className="collections-help">Seguimiento desde el 14/10/2026. Los servicios cancelados dejan de generar cobranzas pendientes. Los avisos comienzan en la fecha del servicio o de su primera jornada vigente.</p>
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
        <td data-label="Fecha del servicio">{dateLabel(schedule(record).date)}<small>{schedule(record).time || 'Sin horario'}</small></td>
        <td data-label="Cliente y servicio"><strong>{record.client}</strong><small>{record.service}</small><small>{schedule(record).status} · {(schedule(record).technicians || []).join(' / ') || 'Sin técnicos asignados'}</small></td>
        <td data-label="Monto"><strong>{collectionMoney(record.amount)}</strong></td>
        <td data-label="Forma de pago">{record.paymentMethod}</td>
        <td data-label="Estado del pago"><span className={`collection-status ${collectionConfirmed(record) ? 'confirmed' : ''}`}>{collectionConfirmed(record) ? 'Confirmado' : 'Pendiente de pago'}</span>{record.collection?.confirmedAt && <small>{timestamp(record.collection.confirmedAt)}</small>}</td>
        <td data-label="Acciones"><button title="Abrí el detalle del pago y las acciones de cobranza disponibles." type="button" className="secondary" aria-label={`${mayManage(record) ? 'Gestionar' : 'Ver'} cobranza de ${record.client}`} onClick={() => setSelection(record)}><Icon name={mayManage(record) ? 'edit' : 'eye'} />{mayManage(record) ? 'Gestionar' : 'Ver detalle'}</button></td>
      </tr>)}</tbody>
    </table>{!filtered.length && <p className="empty-state">No hay cobranzas que coincidan con estos filtros.</p>}</div>
    {pages > 1 && <nav className="collections-pagination" aria-label="Paginación de cobranzas"><button title="Consultá la página anterior de cobranzas." className="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage} de {pages}</span><button title="Consultá la siguiente página de cobranzas." className="secondary" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
    {selectedVisibleRecord && <CollectionEditor key={selection.id} record={selection} currentRecord={selectedVisibleRecord} effectiveRecord={schedule(selectedVisibleRecord)} customers={customers} serviceDate={schedule(selection).date} canManage={mayManage(selectedVisibleRecord)} onSave={onSave} close={() => setSelection(null)} onSaved={message => { setSelection(null); setNotice(message) }} />}
  </div>
}

function CollectionEditor({ record, currentRecord, effectiveRecord, customers, serviceDate, canManage, onSave, close, onSaved }) {
  const { can, user } = useActionPermissions()
  const { can: hasPermission } = usePermissions()
  const canView = hasPermission('collections.view') && hasPermission('records.financial')
  const writable = canWriteRecord(currentRecord, user, customers) && canWriteRecord(effectiveRecord, user, customers)
  const canConfirm = writable && can('collections.confirm', canManage)
  const canAmount = writable && can('collections.amount', canManage)
  const canMethod = writable && can('collections.method', canManage)
  const canCorrect = canAmount || canMethod
  canManage = canConfirm || canCorrect
  const [amount, setAmount] = useState(String(record.amount))
  const [amountFocused, setAmountFocused] = useState(false)
  const [method, setMethod] = useState(record.paymentMethod)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [preparingReceipt, setPreparingReceipt] = useState(false)
  const saving = useRef(false), preparing = useRef(false)
  const normalizedAmount = parseCollectionAmount(amount)
  const changed = normalizedAmount === null || Number(normalizedAmount) !== Number(record.amount) || method !== record.paymentMethod
  const confirmed = collectionConfirmed(record)
  const currentReceipt = record.collection?.receipt
  const receiptRequired = ['Transferencia', 'Débito', 'Crédito'].includes(method)
  const needsNewReceipt = confirmed && method !== record.paymentMethod && receiptRequired
  const missingConfirmationReceipt = receiptRequired && !receipt && !currentReceipt
  const missingCorrectionReceipt = needsNewReceipt && !receipt
  const prepareReceipt = value => { preparing.current = value; setPreparingReceipt(value) }
  const changeReceipt = value => { setReceipt(value); setError('') }
  const save = async event => {
    event.preventDefault()
    if (saving.current || preparing.current || !canView) return
    const action = event.nativeEvent.submitter?.value || (confirmed && receipt && !changed ? 'receipt' : 'correct')
    if ((action === 'confirm' && !canConfirm) || (action === 'correct' && !canCorrect) || (action === 'receipt' && (!canConfirm || !confirmed))) return
    if (receipt && !canConfirm) { setError('Ya no tenés permiso para guardar comprobantes.'); return }
    if (action === 'receipt' && (!receipt || changed)) { setError('Para adjuntar el comprobante, conservá el importe y la forma de pago del registro.'); return }
    if (normalizedAmount === null) {
      setError('Ingresá un monto mayor a cero y hasta 999.999.999,99, con un máximo de dos decimales. Podés usar coma o punto.')
      return
    }
    if ((!canAmount && Number(normalizedAmount) !== Number(record.amount)) || (!canMethod && method !== record.paymentMethod)) return
    if (action === 'confirm' && missingConfirmationReceipt) { setError('Adjuntá el comprobante antes de confirmar este pago.'); return }
    if (action === 'correct' && missingCorrectionReceipt) { setError('Adjuntá un comprobante nuevo para la nueva forma de pago.'); return }
    if (action === 'correct' && !changed) { setError('No hay cambios en el importe ni en la forma de pago.'); return }
    saving.current = true; setBusy(true); setError('')
    try {
      await onSave({
        recordId: record.id, base: collectionBase(record), action, amount: normalizedAmount, paymentMethod: method, note,
        ...(receipt ? { receipt: { id: receipt.id, name: receipt.name, data: receipt.data } } : {})
      })
      onSaved(action === 'confirm' ? 'Pago confirmado. La notificación de cobranza fue resuelta.' : action === 'receipt' ? 'Comprobante guardado. El pago conserva su confirmación.' : 'Corrección guardada en el historial de la cobranza.')
    } catch (failure) { setError(failure.message || 'No se pudo guardar. Intentá nuevamente.') }
    finally { saving.current = false; setBusy(false) }
  }
  if (!canView) return null
  const receiptField = <CollectionReceiptField recordId={record.id} current={currentReceipt} versions={record.collection?.receipts || []}
    value={receipt} onChange={changeReceipt} onPreparing={prepareReceipt} editable={canConfirm} disabled={busy}
    required={receiptRequired} confirmed={confirmed} needsReplacement={needsNewReceipt} showHistory={can('collections.timeline')} />
  return <div className="collections-editor"><EditorModal active title={canManage ? 'Gestionar cobranza' : 'Detalle de cobranza'} eyebrow={confirmed ? 'PAGO CONFIRMADO' : 'PENDIENTE DE PAGO'} onClose={close} dirty={canManage && (changed || Boolean(note) || Boolean(receipt) || preparingReceipt)} busy={busy || preparingReceipt}>
    <p><strong>{record.client}</strong><br />{record.service} · {dateLabel(serviceDate)}{record.serviceJourney && <><br />Cobranza única del servicio, desde su primera jornada vigente.</>}</p>
    <section className="collection-owner" aria-label="Responsable de cobranza">
      <span>Responsable de cobranza</span>
      <strong>{record.createdBy?.name || 'Autor original no disponible'}</strong>
      <small>{record.createdBy?.name ? 'Cargó el servicio en la agenda semanal.' : 'Este servicio no tiene registrado el nombre de quien lo cargó.'}</small>
    </section>
    {record.collection?.confirmedAt && <p>Confirmado por {record.collection.confirmedBy?.name} · {timestamp(record.collection.confirmedAt)}</p>}
    {canManage ? <form onSubmit={save}><fieldset disabled={busy}>
      <div className="collection-fields">
        <label>Monto {collectionConfirmed(record) ? 'cobrado' : 'a cobrar'} ($)<input disabled={!canAmount} required type="text" inputMode="decimal" value={amountFocused ? amount : displayCollectionAmount(amount)} onFocus={() => { setAmountFocused(true); if (normalizedAmount !== null) setAmount(normalizedAmount.replace('.', ',')) }} onChange={event => setAmount(event.target.value)} onBlur={() => setAmountFocused(false)} /></label>
        <label>Forma de pago<select disabled={!canMethod} required value={method} onChange={event => setMethod(event.target.value)}>{!COLLECTION_PAYMENT_METHODS.includes(method) && <option value={method} disabled>{method || 'Seleccionar'}</option>}{COLLECTION_PAYMENT_METHODS.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {receiptField}
      {missingCorrectionReceipt && !canConfirm && <p className="collections-help" role="status">El cambio de forma de pago requiere un comprobante nuevo. Tu rol no permite adjuntarlo.</p>}
      <label>Observación (opcional)<textarea maxLength={1000} rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="Por ejemplo: transfirió en lugar de pagar en efectivo" /></label>
      <p className="collections-help">{collectionConfirmed(record) ? 'La rectificación conserva el pago confirmado y registra los valores anteriores.' : 'Guardar una corrección mantiene el pago pendiente. Confirmá sólo después de verificar que se recibió el dinero.'}</p>
      {error && <p className="collection-error" role="alert">{error}</p>}
      <div className="collection-actions">{canCorrect && <button title="Guardá la corrección del importe, medio de pago y observaciones." className="secondary" type="submit" value="correct" disabled={!changed || busy || preparingReceipt || missingCorrectionReceipt}>Guardar corrección</button>}{canConfirm && !confirmed && <button title={missingConfirmationReceipt ? 'Adjuntá el comprobante para habilitar la confirmación del pago.' : 'Confirmá el pago recibido y registrá la cobranza.'} className="primary" type="submit" value="confirm" disabled={busy || preparingReceipt || missingConfirmationReceipt || !COLLECTION_PAYMENT_METHODS.includes(method)}><Icon name="check" />{busy ? 'Guardando…' : 'Confirmar pago'}</button>}{canConfirm && confirmed && <button title="Guardá el comprobante conservando el importe, la forma de pago y la confirmación original." className="primary collection-receipt-submit" type="submit" value="receipt" disabled={busy || preparingReceipt || !receipt || changed}><Icon name="upload" size={16} />{busy ? 'Guardando…' : currentReceipt ? 'Reemplazar comprobante' : 'Adjuntar comprobante'}</button>}</div>
    </fieldset></form> : <><p>{terms(record)}</p>{receiptField}</>}
    {can('collections.timeline') && <section className="collection-trace" aria-label="Historial de la cobranza"><h3>Historial de la cobranza</h3>
      <p>Datos iniciales: {terms(record.collection?.original || record)}</p>
      {record.collection?.events?.length ? <ol>{[...record.collection.events].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><strong>{entry.action === 'confirm' ? 'Pago confirmado' : entry.action === 'receipt' ? 'Comprobante registrado' : 'Datos rectificados'}</strong><small>{timestamp(entry.at)} · {entry.actor.name}</small>{entry.action !== 'receipt' && <p>{terms(entry.before)} → {terms(entry.after)}</p>}{entry.note && <p>{entry.note}</p>}</li>)}</ol> : <p className="collections-help">Todavía no se registraron gestiones de esta cobranza.</p>}
    </section>}
  </EditorModal></div>
}
