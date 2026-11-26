import React, { useState } from 'react'
import productCatalog from '../../../../shared/product-catalog.cjs'
import ProductPhotos from './ProductPhotos.jsx'
import { isIrSource, isPerimeter } from '../domain/equipment-catalog.mjs'
const normalize = value => String(value || '').normalize('NFD').toUpperCase().replace(/^(?:DH|DHI)-/, '').replace(/[^A-Z0-9]/g, '')

export default function EquipmentModelInput({ value, onChange, category, kind, brand, catalog, options, kindLabels, disabled, catalogUnavailable, label = 'Modelo' }) {
  const [query, setQuery] = useState('')
  const search = query.trim().split(/\s+/).map(normalize).filter(Boolean)
  const [family, setFamily] = useState('')
  const [showAll, setShowAll] = useState(false)
  const kinds = [...new Set(options.map(product => product.kind))]
  const snapshot = { category, kind, brand, model: value }
  const selected = value && catalog.find(snapshot)
  const showBrand = !brand || isPerimeter(category)
  const description = product => [showBrand && product.brand, product.description].filter(Boolean).join(' · ')
  const matches = options.filter(product => {
    if (kinds.includes(family) && product.kind !== family) return false
    if (!search.length) return true
    const searchable = normalize([productCatalog.searchableModel(product), product.brand, product.description].join(' '))
    return search.every(word => searchable.includes(word))
  })
  const visible = showAll ? matches : matches.slice(0, 60)
  const selectProduct = id => {
    const product = options.find(item => item.id === id)
    onChange(product?.model || '', product?.brand)
  }
  const selectedId = value ? selected?.id || 'saved-model' : ''
  const readOnlyCatalog = disabled || catalogUnavailable
  return <div className="cctv-model-picker">
    {kinds.length > 1 && <label>Familia de equipo<select disabled={readOnlyCatalog} value={kinds.includes(family) ? family : ''} onChange={event => setFamily(event.target.value)}>
      <option value="">Todas</option>
      {kinds.map(kind => <option key={kind} value={kind}>{kindLabels[kind] || kind}</option>)}
    </select></label>}
    <label>Buscar en el catálogo<input type="search" disabled={readOnlyCatalog} maxLength={100} value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} placeholder="Código, marca o componente" autoComplete="off" /></label>
    <label>{label}<select disabled={readOnlyCatalog} value={selectedId} onChange={event => selectProduct(event.target.value)}>
      <option value="">Sin especificar</option>
      {value && !visible.includes(selected) && <option value={selectedId} disabled={!selected || !options.includes(selected)}>{[value, selected && description(selected)].filter(Boolean).join(' · ')}</option>}
      {visible.map(product => <option key={product.id} value={product.id}>{[product.model, description(product)].filter(Boolean).join(' · ')}</option>)}
    </select></label>
    <small aria-live="polite">{matches.length > 60 && !showAll ? `60 de ${matches.length} modelos del catálogo.` : `${matches.length} modelo(s) del catálogo.`}</small>
    <ProductPhotos catalog={catalog} selected={value ? { ...snapshot, id: selectedId } : null} choices={matches} photoChoice={product => ({ ...product, detail: description(product) })} filterKey={JSON.stringify([family, query])}
      disabled={readOnlyCatalog} onChoose={selectProduct} sourceProvided />
    {matches.length > 60 && <button className="secondary" type="button" disabled={readOnlyCatalog} onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar primeros 60' : 'Mostrar todos los resultados'}</button>}
    {selected?.source && <a href={selected.source} target="_blank" rel="noreferrer">{isIrSource(selected.source) ? 'Ver ficha en IR Seguridad' : 'Ver ficha del producto'}</a>}
    <details><summary>Ingresar modelo manualmente</summary><label>Código del modelo<input disabled={disabled} maxLength={100} value={value || ''} onChange={event => onChange(event.target.value)} /></label></details>
  </div>
}
