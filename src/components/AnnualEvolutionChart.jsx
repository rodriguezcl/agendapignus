import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { annualChartModel } from '../domain/dashboard/annual-chart-model.mjs'
import './annual-evolution-chart.css'

const seriesColors = {
  docta: 'var(--chart-docta)',
  'nobu-town': 'var(--chart-nobu)',
  residencial: 'var(--chart-residential)',
  retirements: 'var(--chart-retirements)'
}
const quantity = value => value.toLocaleString('es-AR')

// Monotone cubic interpolation: smooth curves stay between the monthly values.
function linePath(points) {
  if (!points.length) return ''
  if (points.length === 1) return `M${points[0].x},${points[0].y}`
  const slopes = points.slice(1).map((point, i) => (point.y - points[i].y) / (point.x - points[i].x))
  const tangents = points.map((_, i) => i === 0 ? slopes[0] : i === points.length - 1 ? slopes.at(-1) : slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2)
  slopes.forEach((slope, i) => {
    if (!slope) { tangents[i] = 0; tangents[i + 1] = 0; return }
    const magnitude = Math.hypot(tangents[i] / slope, tangents[i + 1] / slope)
    if (magnitude > 3) { tangents[i] *= 3 / magnitude; tangents[i + 1] *= 3 / magnitude }
  })
  return points.slice(1).reduce((path, point, i) => {
    const previous = points[i]
    const dx = (point.x - previous.x) / 3
    return `${path} C${previous.x + dx},${previous.y + tangents[i] * dx} ${point.x - dx},${point.y - tangents[i + 1] * dx} ${point.x},${point.y}`
  }, `M${points[0].x},${points[0].y}`)
}

export default function AnnualEvolutionChart({ months = [], year, subtitle }) {
  const model = useMemo(() => annualChartModel(months), [months])
  const [hidden, setHidden] = useState([])
  const [activeIndex, setActiveIndex] = useState(null)
  const [width, setWidth] = useState(640)
  const plot = useRef(null)
  const id = useId().replace(/:/g, '')
  const visibleSeries = model.series.filter(series => !hidden.includes(series.key))
  const active = activeIndex != null && activeIndex < months.length ? activeIndex : null
  const height = 300
  const margin = { left: Math.max(44, quantity(model.axis.max).length * 7 + 12), right: 18, top: 30, bottom: width < 420 ? 52 : 38 }
  const plotWidth = Math.max(1, width - margin.left - margin.right)
  const bottom = height - margin.bottom
  const x = index => margin.left + (months.length > 1 ? index / (months.length - 1) : .5) * plotWidth
  const y = value => bottom - value / model.axis.max * (bottom - margin.top)
  const pointsFor = series => series.values.map((value, index) => ({ x: x(index), y: y(value) }))
  const monthLabel = index => `${months[index].label} ${year}`

  useEffect(() => {
    const element = plot.current
    if (!element) return undefined
    const measure = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)))
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setActiveIndex(null), [year, months.length])

  const pointLabel = index => `${monthLabel(index)}. ${visibleSeries.map(series => `${series.label}: ${quantity(series.values[index])}`).join('. ')}`
  const moveFocus = (event, index) => {
    const next = { ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(months.length - 1, index + 1), Home: 0, End: months.length - 1 }[event.key]
    if (next != null) { event.preventDefault(); plot.current?.querySelectorAll('.chart-hit-target')[next]?.focus() }
    if (event.key === 'Escape') { event.preventDefault(); setActiveIndex(null) }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveIndex(index) }
  }

  return <article className="data-card annual-chart annual-evolution-card">
    <header className="annual-evolution-header"><p className="eyebrow">EVOLUCIÓN ANUAL</p><h2 id={`${id}-title`}>Instalaciones y bajas · {year}</h2>{subtitle && <p className="annual-evolution-subtitle">{subtitle}</p>}</header>
    <div className="annual-evolution-chart">
      <div ref={plot} className="annual-evolution-plot" onPointerLeave={() => { if (!plot.current?.contains(document.activeElement)) setActiveIndex(null) }}>
        {months.length > 0 ? <svg className="annual-evolution-svg" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-labelledby={`${id}-title`}>
          <defs>{model.series.map(series => <linearGradient id={`${id}-${series.key}`} key={series.key} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={seriesColors[series.key]} stopOpacity=".22" /><stop offset="100%" stopColor={seriesColors[series.key]} stopOpacity=".015" /></linearGradient>)}</defs>
          <text className="axis-caption" x={margin.left} y="14">Cantidad</text>
          {model.axis.ticks.map(value => <g key={value}><line className="grid-line" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="axis-tick y-tick" x={margin.left - 10} y={y(value)} dy=".35em" textAnchor="end">{quantity(value)}</text></g>)}
          <line className="axis-line" x1={margin.left} x2={width - margin.right} y1={bottom} y2={bottom} />
          {months.map((month, index) => <text key={month.key || index} className="axis-tick x-tick" x={x(index)} y={bottom + 22} textAnchor={width < 420 ? 'end' : 'middle'} transform={width < 420 ? `rotate(-35 ${x(index)} ${bottom + 22})` : undefined}>{month.label}</text>)}
          {model.hasData && visibleSeries.map(series => {
            const points = pointsFor(series)
            const path = linePath(points)
            return points.length > 1 && <path key={series.key} className="series-area" data-series={series.key} d={`${path} L${points.at(-1).x},${bottom} L${points[0].x},${bottom} Z`} fill={`url(#${id}-${series.key})`} />
          })}
          {model.hasData && visibleSeries.map(series => <g key={series.key} style={{ '--series-color': seriesColors[series.key] }}>
            <path className="series-line" data-series={series.key} d={linePath(pointsFor(series))} />
            {(months.length === 1 || active != null) && <circle className="series-point" cx={x(active ?? 0)} cy={y(series.values[active ?? 0])} r="4" />}
          </g>)}
          {active != null && <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1={margin.top} y2={bottom} />}
          {months.map((month, index) => {
            const left = index ? (x(index - 1) + x(index)) / 2 : margin.left
            const right = index < months.length - 1 ? (x(index) + x(index + 1)) / 2 : width - margin.right
            return <rect key={month.key || index} className="chart-hit-target" x={left} y={margin.top} width={right - left} height={bottom - margin.top} fill="transparent" tabIndex={0} role="button" aria-label={pointLabel(index)} onPointerEnter={() => setActiveIndex(index)} onPointerMove={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={event => { if (!plot.current?.contains(event.relatedTarget)) setActiveIndex(null) }} onKeyDown={event => moveFocus(event, index)} />
          })}
        </svg> : <p className="annual-evolution-empty">Todavía no hay meses transcurridos para este año.</p>}
        {active != null && visibleSeries.length > 0 && <div className="annual-evolution-tooltip" role="status" aria-live="polite"><strong>{monthLabel(active)}</strong>{visibleSeries.map(series => <div key={series.key}><i style={{ background: seriesColors[series.key] }} /><span>{series.label}</span><b>{quantity(series.values[active])}</b></div>)}</div>}
      </div>
      {months.length > 0 && !model.hasData && <p className="annual-evolution-empty">Sin instalaciones ni bajas registradas en este período.</p>}
      {model.hasData && !visibleSeries.length && <p className="annual-evolution-empty">Seleccioná una serie para verla en el gráfico.</p>}
      <div className="annual-evolution-legend" aria-label="Series del gráfico">{model.series.map(series => <button type="button" key={series.key} data-series={series.key} aria-pressed={!hidden.includes(series.key)} title={`${hidden.includes(series.key) ? 'Mostrar' : 'Ocultar'} ${series.label}`} style={{ '--series-color': seriesColors[series.key] }} onClick={() => { setHidden(current => current.includes(series.key) ? current.filter(key => key !== series.key) : [...current, series.key]); setActiveIndex(null) }}><i aria-hidden="true" /><span>{series.label}</span></button>)}</div>
      <table className="annual-evolution-data"><caption>Cantidades mensuales de {year}</caption><thead><tr><th scope="col">Mes</th>{model.series.map(series => <th key={series.key} scope="col">{series.label}</th>)}</tr></thead><tbody>{months.map((month, index) => <tr key={month.key || index}><th scope="row">{monthLabel(index)}</th>{model.series.map(series => <td key={series.key}>{quantity(series.values[index])}</td>)}</tr>)}</tbody></table>
    </div>
  </article>
}
