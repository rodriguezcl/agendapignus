import React, { useEffect, useId, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon.jsx'
import { collectionMoney } from '../../../domain/collections/collections.mjs'
import './collections-overview.css'

const quantity = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)
const compactAmount = value => {
  const scale = value >= 1e9 ? [1e9, ' mil M'] : value >= 1e6 ? [1e6, ' M'] : value >= 1e3 ? [1e3, ' mil'] : [1, '']
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value / scale[0])}${scale[1]}`
}
const serviceCount = count => `${quantity(count)} ${count === 1 ? 'servicio' : 'servicios'}`
const states = [
  { key: 'confirmed', label: 'Confirmados', context: 'Pagos confirmados' },
  { key: 'pending', label: 'Pendientes', context: 'Hoy y fechas anteriores' },
  { key: 'future', label: 'Por cobrar · futuros', context: 'Servicios con fecha futura' },
]
const weekDescription = week => `${week.label}. ${states.map(state => `${state.label}: ${collectionMoney(week[state.key].amount)}, ${serviceCount(week[state.key].count)}`).join('. ')}.`

export default function CollectionsOverviewChart({ model, periodLabel, onOpenCollections }) {
  const id = `collections-${useId().replaceAll(':', '')}`
  const plot = useRef(null)
  const [width, setWidth] = useState(520)
  const [activeWeek, setActiveWeek] = useState(null)
  const [focusWeek, setFocusWeek] = useState(null)
  const { totals, weeks, trackingAvailable, hasData } = model
  const selected = weeks.find(week => week.key === activeWeek)
  const tabStop = weeks.some(week => week.key === focusWeek) ? focusWeek : weeks[0]?.key
  const showChart = trackingAvailable && hasData

  useEffect(() => {
    const element = plot.current
    const measure = () => {
      if (element?.clientWidth > 0) setWidth(Math.max(180, element.clientWidth))
    }
    measure()
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setActiveWeek(null); setFocusWeek(null) }, [model.month])

  const height = 210
  const margin = { left: 55, right: 12, top: 25, bottom: 35 }
  const bottom = height - margin.bottom
  const maxAmount = Math.max(0, ...weeks.map(week => states.reduce((sum, state) => sum + week[state.key].amount, 0)))
  const rawStep = maxAmount / 3 || 1
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = ([1, 2, 2.5, 5, 10].find(value => value * magnitude >= rawStep) || 10) * magnitude
  const ceiling = step * 3
  const y = amount => bottom - amount / ceiling * (bottom - margin.top)
  const slot = (width - margin.left - margin.right) / Math.max(1, weeks.length)
  const barWidth = Math.min(48, slot * .62)
  const center = index => margin.left + (index + .5) * slot
  const moveFocus = (event, index) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setActiveWeek(null)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setActiveWeek(weeks[index].key)
      return
    }
    const next = event.key === 'ArrowRight' ? Math.min(weeks.length - 1, index + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? weeks.length - 1 : null
    if (next === null) return
    event.preventDefault()
    plot.current?.querySelectorAll('.collections-week-target')[next]?.focus()
  }
  const clearPointerSelection = () => {
    if (!plot.current?.contains(document.activeElement)) setActiveWeek(null)
  }

  return <article className="data-card dashboard-chart-card collections-overview-card" aria-labelledby={`${id}-title`}>
    <header className="dashboard-chart-heading">
      <p className="eyebrow">SEGUIMIENTO DE PAGOS</p>
      <h2 id={`${id}-title`}>Estado de cobranzas</h2>
      <p className="dashboard-chart-period">{periodLabel}</p>
    </header>
    <div className="collections-overview-summary">
      <span>Pendiente · hoy y fechas anteriores</span>
      <strong>{trackingAvailable ? collectionMoney(totals.pending.amount) : '—'}</strong>
      <small>{trackingAvailable ? `${serviceCount(totals.pending.count)} del período por confirmar` : 'Período anterior al seguimiento de cobranzas'}</small>
    </div>
    <div className="collections-overview-plot" ref={plot} onPointerLeave={clearPointerSelection}>
      {showChart ? <svg className="collections-overview-svg" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-labelledby={`${id}-title ${id}-description`}>
        <desc id={`${id}-description`}>Importes en pesos argentinos agrupados por semana de la fecha del servicio. Cada barra combina pagos confirmados, pendientes de hoy o fechas anteriores y pagos por cobrar de servicios futuros. Usá las flechas para consultar cada semana. Los importes y cantidades también están disponibles en la tabla de datos.</desc>
        <defs>
          <pattern id={`${id}-pending-pattern`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="7" height="7" fill="var(--collections-pending)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--ap-surface)" strokeWidth="2" strokeOpacity=".25" />
          </pattern>
        </defs>
        <text className="insight-axis" x={margin.left} y="12">Importe · ARS</text>
        {[0, step, step * 2, ceiling].map(amount => <g key={amount}>
          <line className={`insight-grid${amount === 0 ? ' insight-zero' : ''}`} x1={margin.left} x2={width - margin.right} y1={y(amount)} y2={y(amount)} />
          <text className="insight-axis" x={margin.left - 8} y={y(amount)} dy=".35em" textAnchor="end">{compactAmount(amount)}</text>
        </g>)}
        {weeks.map((week, index) => {
          let stacked = 0
          return <g key={week.key} className={`collections-week${activeWeek === week.key ? ' is-active' : ''}`}>
            {states.map(state => {
              const amount = week[state.key].amount
              const start = stacked
              stacked += amount
              return amount > 0 && <rect key={state.key} className={`collections-bar is-${state.key}`}
                x={center(index) - barWidth / 2} y={y(stacked)} width={barWidth} height={y(start) - y(stacked)}
                fill={state.key === 'pending' ? `url(#${id}-pending-pattern)` : `var(--collections-${state.key})`}>
                <title>{week.label} · {state.label}: {collectionMoney(amount)} · {serviceCount(week[state.key].count)}</title>
              </rect>
            })}
            <text className="insight-axis collections-week-label" x={center(index)} y={height - 15} textAnchor="middle">{width < 400 ? week.label.replace(/\s+\S+$/, '') : week.label}</text>
            <rect className="collections-week-target" data-week={week.key} x={margin.left + index * slot + 2} y={margin.top - 3}
              width={Math.max(1, slot - 4)} height={bottom - margin.top + 8} fill="transparent" rx="4" role="button"
              tabIndex={tabStop === week.key ? 0 : -1} aria-label={weekDescription(week)} aria-pressed={activeWeek === week.key}
              onPointerEnter={event => { if (event.pointerType !== 'touch') setActiveWeek(week.key) }}
              onClick={() => setActiveWeek(week.key)}
              onFocus={() => { setFocusWeek(week.key); setActiveWeek(week.key) }}
              onBlur={event => { if (!plot.current?.contains(event.relatedTarget)) setActiveWeek(null) }}
              onKeyDown={event => moveFocus(event, index)} />
          </g>
        })}
      </svg> : <div className="dashboard-chart-empty collections-overview-empty">
        <strong>{trackingAvailable ? 'Sin cobranzas en este período' : 'Sin seguimiento para este período'}</strong>
        <span>{trackingAvailable ? 'Los importes aparecerán cuando haya servicios con cobro registrado.' : 'La información de este mes no tiene cobertura completa.'}</span>
      </div>}
      {selected && <div className="collections-overview-tooltip" role="status">
        <strong>{selected.label}</strong>
        {states.map(state => <div key={state.key}><span>{state.label}</span><b>{collectionMoney(selected[state.key].amount)}</b><small>{serviceCount(selected[state.key].count)}</small></div>)}
      </div>}
    </div>
    {trackingAvailable && <ul className="collections-overview-legend collections-overview-totals" aria-label="Totales de cobranzas del período">
      {states.map(state => <li key={state.key} className={`is-${state.key}`} data-state={state.key}>
        <div className="collections-legend-label"><i aria-hidden="true" /><span>{state.label}</span></div>
        <strong>{collectionMoney(totals[state.key].amount)}</strong>
        <small>{serviceCount(totals[state.key].count)}</small>
        <span className="collections-legend-context">{state.context}</span>
      </li>)}
    </ul>}
    <footer className="dashboard-chart-footer collections-overview-footer">
      <p>Estado actual de los pagos, agrupado por fecha del servicio. No representa la fecha en que se recibió cada pago.</p>
      {model.coverageNote && <p className="collections-overview-coverage">{model.coverageNote}</p>}
      {onOpenCollections && <button type="button" className="secondary collections-overview-open" title={`Consultá las cobranzas de ${periodLabel}.`}
        onClick={() => onOpenCollections({ from: model.from, through: model.through, status: 'all' })}><Icon name="wallet" size={16} />Ver cobranzas</button>}
    </footer>
    {showChart && <table className="dashboard-chart-data collections-overview-data">
      <caption>Estado actual de cobranzas de {periodLabel}, por fecha del servicio. Importes en pesos argentinos.</caption>
      <thead><tr><th scope="col">Semana</th>{states.map(state => <React.Fragment key={state.key}><th scope="col">{state.label} · importe</th><th scope="col">{state.label} · servicios</th></React.Fragment>)}</tr></thead>
      <tbody>{weeks.map(week => <tr key={week.key}><th scope="row">{week.label}</th>{states.map(state => <React.Fragment key={state.key}><td>{collectionMoney(week[state.key].amount)}</td><td>{quantity(week[state.key].count)}</td></React.Fragment>)}</tr>)}</tbody>
    </table>}
  </article>
}
