import React from 'react'
import './service-materials-summary.css'

export default function ServiceMaterialsSummary({ materials }) {
  if (!materials?.length) return null

  return <section className="service-materials-summary" aria-label="Materiales entregados al equipo">
    <h3>Materiales entregados al equipo</h3>
    <ul>
      {materials.map(({ productId, name, model, quantity }) => <li key={productId}>
        <div><strong>{name}</strong><small>{model}</small></div>
        <span>{quantity} {quantity === 1 ? 'unidad' : 'unidades'}</span>
      </li>)}
    </ul>
  </section>
}
