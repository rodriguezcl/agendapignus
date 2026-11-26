import React, { lazy, Suspense, useState } from 'react'
import Icon from '../../../components/ui/Icon.jsx'
import ServiceMaterialsSummary from '../../services/presentation/ServiceMaterialsSummary.jsx'
import './service-materials-field.css'

const ServiceMaterialSearch = lazy(() => import('./ServiceMaterialSearch.jsx'))

export default function ServiceMaterialsField({ materials = [], readOnly, onChange }) {
  const [searchOpen, setSearchOpen] = useState(false)
  if (readOnly) return <ServiceMaterialsSummary materials={materials} />

  function setQuantity(productId, quantity) {
    if (Number.isSafeInteger(quantity) && quantity > 0) {
      onChange(materials.map(line => line.productId === productId ? { ...line, quantity } : line))
    }
  }
  function add(product) {
    const existing = materials.find(line => line.productId === product.productId)
    if (existing) setQuantity(existing.productId, existing.quantity + 1)
    else onChange([...materials, product])
  }

  return <section className="service-materials-field" aria-label="Materiales entregados al equipo">
    <header>
      <h3>Materiales entregados al equipo</h3>
      <button type="button" className="secondary small" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>
        <Icon name={searchOpen ? 'close' : 'plus'} size={15} />{searchOpen ? 'Cerrar búsqueda' : 'Agregar producto'}
      </button>
    </header>
    {searchOpen && <Suspense fallback={<small role="status">Cargando buscador…</small>}>
      <ServiceMaterialSearch onSelect={add} />
    </Suspense>}
    {materials.length > 0 && <ul className="service-materials-lines">
      {materials.map(line => <li key={line.productId}>
        <div><strong>{line.name}</strong><small>{line.model}</small></div>
        <label>Cantidad
          <input type="number" min="1" step="1" value={line.quantity}
            aria-label={`Cantidad de ${line.model}`} onFocus={event => event.target.select()}
            onChange={event => setQuantity(line.productId, event.target.valueAsNumber)} />
        </label>
        <button type="button" className="secondary small" aria-label={`Quitar ${line.model}`}
          title={`Quitar ${line.model}`} onClick={() => onChange(materials.filter(item => item.productId !== line.productId))}>
          <Icon name="trash" size={16} />
        </button>
      </li>)}
    </ul>}
  </section>
}
