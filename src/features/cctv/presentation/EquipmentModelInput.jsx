import React, { useState } from 'react'
const normalize = value => String(value || '').normalize('NFD').toUpperCase().replace(/^(?:DH|DHI)-/, '').replace(/[^A-Z0-9]/g, '')

export default function EquipmentModelInput({ value, onChange, groups, kindLabels, products, disabled, label = 'Modelo' }) {
  const [query, setQuery] = useState('')
  const search = query.trim().split(/\s+/).map(normalize).filter(Boolean)
  const [family, setFamily] = useState('')
  const [showAll, setShowAll] = useState(false)
  const kinds = Object.keys(groups)
  const options = [...new Set(kinds.includes(family) ? groups[family] : Object.values(groups).flat())].sort()
  const description = model => [products?.[model]?.brand, products?.[model]?.component].filter(Boolean).join(' · ')
  const matches = search.length ? options.filter(model => {
    const searchable = normalize(`${model} ${description(model)}`)
    return search.every(word => searchable.includes(word))
  }) : options
  const visible = [...new Set([...(value ? [value] : []), ...(showAll ? matches : matches.slice(0, 60))])]
  return <div className="cctv-model-picker">
    {kinds.length > 1 && <label>Familia de equipo<select disabled={disabled} value={kinds.includes(family) ? family : ''} onChange={event => setFamily(event.target.value)}>
      <option value="">Todas</option>
      {kinds.map(kind => <option key={kind} value={kind}>{kindLabels[kind] || kind}</option>)}
    </select></label>}
    <label>Buscar en el catálogo<input type="search" disabled={disabled} maxLength={100} value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} placeholder={products ? 'Código, marca o componente' : 'Código o parte del modelo'} autoComplete="off" /></label>
    <label>{label}<select disabled={disabled} value={value || ''} onChange={event => onChange(event.target.value)}>
      <option value="">Sin especificar</option>
      {visible.map(model => <option key={model} value={model}>{[model, description(model)].filter(Boolean).join(' · ')}</option>)}
    </select></label>
    <small aria-live="polite">{matches.length > 60 && !showAll ? `60 de ${matches.length} modelos del catálogo.` : `${matches.length} modelo(s) del catálogo.`}</small>
    {matches.length > 60 && <button className="secondary" type="button" disabled={disabled} onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar primeros 60' : 'Mostrar todos los resultados'}</button>}
    {products?.[value]?.url && <a href={products[value].url} target="_blank" rel="noreferrer">Ver ficha en IR Seguridad</a>}
    <details><summary>Ingresar modelo manualmente</summary><label>Código del modelo<input disabled={disabled} maxLength={100} value={value || ''} onChange={event => onChange(event.target.value)} /></label></details>
  </div>
}
