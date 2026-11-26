import React, { useEffect, useId, useRef, useState } from 'react'
import { productName } from '../../products/domain/product-name.mjs'

const PAGE_SIZE = 8

function ProductThumbnail({ image, model, caption, enlarge = false }) {
  const [failed, setFailed] = useState('')
  if (!image || failed === image) return <span className="cctv-photo-missing">Imagen no disponible</span>
  const thumbnail = <img className="cctv-product-photo" src={image} alt={`${caption || 'Foto de referencia'} de ${model}`} width="112" height="84"
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} />
  return enlarge ? <a href={image} target="_blank" rel="noreferrer" aria-label={`Ampliar imagen de ${model}`}>{thumbnail}</a> : thumbnail
}

export default function ProductPhotos({ catalog, selected, choices = [], photoChoice, onChoose, disabled, filterKey = '', sourceProvided = false }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0)
  const galleryId = useId(), toggle = useRef(null)
  const active = Boolean(selected?.model || choices.length)
  useEffect(() => setPage(0), [filterKey])
  if (!active) return null

  const reference = selected?.model && catalog.find(selected)
  const illustrated = open ? choices.flatMap(value => {
    const choice = photoChoice(value)
    const photo = catalog.find(choice)
    return photo?.image ? [{ choice, photo }] : []
  }) : []
  const lastPage = Math.max(0, Math.ceil(illustrated.length / PAGE_SIZE) - 1)
  const currentPage = Math.min(page, lastPage), start = currentPage * PAGE_SIZE
  return <div className="cctv-product-photos">
    {reference?.image ? <div className="cctv-photo-preview">
      <ProductThumbnail image={reference.image} model={selected.model} caption={reference.caption} enlarge />
      <div><strong>{selected.model}</strong>
        <small>{productName(reference)}</small>
        {reference.caption && <small>{reference.caption}</small>}
        {catalog.isSharedProductImage(reference.image) && <small>Esta imagen corresponde a varios modelos. Verificá el código del equipo.</small>}
        {!sourceProvided && reference.source && <a href={reference.source} target="_blank" rel="noreferrer">Ver ficha del producto</a>}
      </div>
    </div> : selected?.model && <small>Sin imagen de referencia para este modelo.</small>}
    {onChoose && <button ref={toggle} type="button" className="secondary" aria-expanded={open} aria-controls={galleryId}
      disabled={disabled} onClick={() => { setOpen(!open); setPage(0) }}>{open ? 'Ocultar imágenes' : 'Elegir por imagen'}</button>}
    {onChoose && <div id={galleryId} hidden={!open}>
      {open && (illustrated.length ? <>
        <div className="cctv-photo-grid">{illustrated.slice(start, start + PAGE_SIZE).map(({ choice, photo }) =>
          <button type="button" key={choice.id} className="cctv-photo-choice" disabled={disabled || choice.disabled}
            aria-pressed={selected?.id === choice.id} onClick={() => { onChoose(choice.id); setOpen(false); toggle.current?.focus() }}>
            <ProductThumbnail image={photo.image} model={choice.model} caption={photo.caption} />
            <span><strong>{choice.model}</strong>{photo.caption && <small>{photo.caption}</small>}{choice.detail && <small>{choice.detail}</small>}</span>
          </button>)}</div>
        {lastPage > 0 && <div className="cctv-photo-pages">
          <button type="button" className="secondary" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
          <small aria-live="polite">{start + 1}–{Math.min(start + PAGE_SIZE, illustrated.length)} de {illustrated.length} con imagen</small>
          <button type="button" className="secondary" disabled={disabled || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Siguiente</button>
        </div>}
      </> : <small>No hay imágenes de referencia para esta selección.</small>)}
    </div>}
  </div>
}
