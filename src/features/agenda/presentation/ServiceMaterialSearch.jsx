import React, { useMemo, useRef, useState } from 'react'
import { useProductCatalog } from '../../products/application/useProductCatalog.mjs'
import { indexProducts, productSearchWords } from '../../products/domain/product-search.mjs'

const pageSize = 12

export default function ServiceMaterialSearch({ onSelect }) {
  const { products, loading, error, refresh } = useProductCatalog()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const searchInput = useRef(null)
  const index = useMemo(() => indexProducts(products.filter(product => product.active)), [products])
  const matches = useMemo(() => {
    const words = productSearchWords(query)
    return words.length ? index.filter(({ searchable }) => words.every(word => searchable.includes(word))) : []
  }, [index, query])

  if (error) return <div className="service-materials-search" role="alert">
    <span>{error}</span>
    <button type="button" className="secondary" onClick={refresh}>Reintentar</button>
  </div>
  return <div className="service-materials-search" aria-busy={loading}>
    <label>Buscar en Productos
      <input ref={searchInput} type="search" autoFocus autoComplete="off" placeholder="Código, marca, equipo o características"
        value={query} onChange={event => { setQuery(event.target.value); setLimit(pageSize) }} />
    </label>
    {loading ? <small role="status">Cargando catálogo…</small> : query.trim() && <>
      <small role="status">{matches.length ? `${matches.length} resultado${matches.length === 1 ? '' : 's'}` : 'No se encontraron productos activos.'}</small>
      {matches.length > 0 && <ul className="service-materials-results">
        {matches.slice(0, limit).map(({ product, name }) => <li key={product.id}>
          <button type="button" aria-label={`Agregar ${product.model} · ${name}`} onClick={() => {
            onSelect({ productId: product.id, model: product.model, brand: product.brand, name, quantity: 1 })
            setQuery('')
            setLimit(pageSize)
            searchInput.current?.focus()
          }}>
            <strong>{product.model}</strong><span>{name}</span>
          </button>
        </li>)}
      </ul>}
      {matches.length > limit && <button type="button" className="secondary small" onClick={() => setLimit(limit + pageSize)}>Ver más resultados</button>}
    </>}
  </div>
}
