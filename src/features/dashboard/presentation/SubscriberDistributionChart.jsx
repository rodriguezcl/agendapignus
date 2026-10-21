import React, { useId } from 'react'

const quantity = value => new Intl.NumberFormat('es-AR').format(value)
const percent = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value)

export default function SubscriberDistributionChart({ model }) {
  const titleId = useId()
  return <article className="data-card dashboard-chart-card subscriber-distribution" aria-labelledby={titleId}>
    <header className="dashboard-chart-heading"><p className="eyebrow">CARTERA ACTUAL</p><h2 id={titleId}>Abonados por ubicación</h2><p className="dashboard-chart-period">Situación actual · independiente del mes de análisis</p></header>
    <div className="subscriber-distribution-body">
      <p className="subscriber-distribution-total"><strong>{quantity(model.total)}</strong><span>abonados activos en tu alcance</span></p>
      {model.total ? <ul className="subscriber-distribution-bars" aria-label="Distribución de abonados activos">{model.items.map(item => <li key={item.key}>
        <div className="subscriber-distribution-label"><span>{item.label}</span><span><b>{quantity(item.count)}</b><small>{percent(item.percentage)} %</small></span></div>
        <div className="subscriber-distribution-track" aria-hidden="true"><div style={{ width: `${item.percentage}%`, background: item.color }} /></div>
      </li>)}</ul> : <div className="dashboard-chart-empty"><strong>Sin abonados activos</strong><span>No hay cuentas computables dentro de tu alcance.</span></div>}
    </div>
    <footer className="dashboard-chart-footer"><p>Excluye cuentas sin abono, automonitoreo y bajas. Residenciales / otras zonas agrupa las cuentas no identificadas como Docta o Nobu Town.</p></footer>
  </article>
}
