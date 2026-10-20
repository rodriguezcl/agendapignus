import React, { useEffect, useId, useRef, useState } from 'react'
import Icon from './ui/Icon.jsx'
import { prepareCollectionReceipt } from '../infrastructure/media/collection-receipt-upload.mjs'
import './collection-receipt.css'

export const collectionReceiptUrl = (recordId, receiptId) => `/api/collections/${encodeURIComponent(String(recordId))}/receipts/${encodeURIComponent(String(receiptId))}`
const sizeLabel = bytes => bytes >= 1_000_000 ? `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB` : `${Math.max(1, Math.ceil(bytes / 1000))} KB`
const createdLabel = receipt => {
  const date = new Date(receipt.createdAt)
  return [receipt.uploadedBy?.name, Number.isFinite(date.getTime()) ? date.toLocaleString('es-AR') : ''].filter(Boolean).join(' · ')
}

export default function CollectionReceiptField({ recordId, current, versions = [], value, onChange, onPreparing, editable = false, disabled = false, required = false, confirmed = false, needsReplacement = false, showHistory = false }) {
  const id = `receipt-${useId().replaceAll(':', '')}`
  const picker = useRef(null), camera = useRef(null), processing = useRef(false), mounted = useRef(true)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const previous = showHistory ? versions.filter(file => file.id !== current?.id) : []
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!value?.data) { setPreviewUrl(''); return undefined }
    const encoded = value.data.slice(value.data.indexOf(',') + 1)
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: value.mime }))
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value])
  const select = async file => {
    if (!file || !editable || disabled || processing.current) return
    processing.current = true
    setPreparing(true)
    setError('')
    onPreparing?.(true)
    try {
      const prepared = await prepareCollectionReceipt(file)
      if (mounted.current) onChange(prepared)
    } catch (failure) {
      if (mounted.current) setError(failure.message || 'No se pudo preparar el comprobante.')
    } finally {
      processing.current = false
      if (mounted.current) { setPreparing(false); onPreparing?.(false) }
    }
  }
  const selectFrom = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    void select(file)
  }
  return <section className="collection-receipt-field" aria-labelledby={`${id}-label`} aria-busy={preparing || undefined}>
    <h3 id={`${id}-label`}>Comprobante{required ? <span aria-label="obligatorio para confirmar"> *</span> : <small> (opcional)</small>}</h3>
    {current && <div className="collection-receipt-saved">
      <Icon name={current.mime?.startsWith('image/') ? 'camera' : 'accounts'} size={22} />
      <div><a className="collection-receipt-link" href={collectionReceiptUrl(recordId, current.id)} target="_blank" rel="noreferrer" title="Abrí el comprobante guardado en una nueva pestaña.">Ver comprobante</a><span>{current.name}</span><small>{sizeLabel(current.bytes)}{createdLabel(current) ? ` · ${createdLabel(current)}` : ''}</small></div>
    </div>}
    {!current && confirmed && <p className="collection-receipt-missing">{required ? 'Este pago sigue confirmado; todavía no tiene un comprobante registrado.' : 'Este pago no tiene un comprobante registrado.'}</p>}
    {editable && <>
      <p className="collection-receipt-help">{needsReplacement ? 'Adjuntá un comprobante nuevo que corresponda a la nueva forma de pago.' : required ? 'Obligatorio al confirmar el pago. Podés adjuntar una imagen o un PDF.' : 'Podés agregar una imagen o un PDF como respaldo del pago en efectivo.'} Hasta 3 MB por archivo.</p>
      <div className="collection-receipt-picker">
        <button type="button" className="secondary" title="Seleccioná una imagen o un PDF del comprobante." disabled={disabled || preparing} onClick={() => picker.current?.click()}><Icon name="upload" size={16} />{value || current ? 'Elegir otro archivo' : 'Adjuntar archivo'}</button>
        <button type="button" className="secondary" title="Tomá una foto del comprobante con la cámara." disabled={disabled || preparing} onClick={() => camera.current?.click()}><Icon name="camera" size={16} />Sacar foto</button>
      </div>
      <input className="collection-receipt-input" ref={picker} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" aria-label="Seleccionar comprobante" aria-describedby={`${id}-hint`} disabled={disabled || preparing} onChange={selectFrom} />
      <input className="collection-receipt-camera" ref={camera} type="file" hidden accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Fotografiar comprobante" disabled={disabled || preparing} onChange={selectFrom} />
      {value && <div className="collection-receipt-draft">
        {value.mime?.startsWith('image/') ? <img className="collection-receipt-preview" src={value.data} alt={`Vista previa del comprobante: ${value.name}`} /> : <span className="collection-receipt-pdf" aria-hidden="true">PDF</span>}
        <div><strong>{value.name}</strong><small>{sizeLabel(value.bytes)} · listo para guardar{value.compressed ? ' · foto comprimida' : ''}</small>{previewUrl && <a className="collection-receipt-review" href={previewUrl} target="_blank" rel="noreferrer" title="Revisá el archivo seleccionado en una nueva pestaña antes de guardarlo.">Revisar archivo</a>}<span>{current ? 'Reemplazará al comprobante actual al guardar; la versión anterior se conservará.' : 'Se guardará junto con la operación de cobranza.'}</span></div>
        <button type="button" className="secondary collection-receipt-remove" title="Quitá sólo el archivo seleccionado; el comprobante guardado se conserva." disabled={disabled || preparing} onClick={() => { onChange(null); setError('') }}>Quitar selección</button>
      </div>}
      <p id={`${id}-hint`} className="collection-receipt-help">Verificá que se lean la fecha, el importe y los datos de la operación. Elegir un archivo no confirma el pago.</p>
    </>}
    {!editable && !current && !confirmed && <p className="collection-receipt-missing">Sin comprobante registrado.</p>}
    {preparing && <p className="collection-receipt-preparing" role="status">Preparando comprobante…</p>}
    {error && <p className="collection-receipt-error" role="alert">{error}</p>}
    {previous.length > 0 && <details className="collection-receipt-history"><summary>Comprobantes anteriores ({previous.length})</summary><ul>{[...previous].reverse().map(file => <li key={file.id}><a href={collectionReceiptUrl(recordId, file.id)} target="_blank" rel="noreferrer" title="Abrí esta versión anterior del comprobante.">{file.name}</a><small>{createdLabel(file)}</small></li>)}</ul></details>}
  </section>
}
