import React, { useEffect, useId, useRef, useState } from 'react'
import './dashboard-insights.css'

const quantity = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)
const signed = value => `${value > 0 ? '+' : ''}${quantity(value)}`
const decimal = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value)
const monthName = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long' })
const dayLabel = point => new Date(`${point.date}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
const linePath = (points, x, y) => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.day)},${y(point.value)}`).join(' ')

export function NetProjectionChart({ model, periodLabel }) {
  const id = `net-${useId().replaceAll(':', '')}`
  const plot = useRef(null)
  const [width, setWidth] = useState(560)
  const [activeDay, setActiveDay] = useState(null)
  useEffect(() => {
    const element = plot.current
    const measure = () => {
      if (element?.clientWidth > 0) setWidth(Math.max(230, element.clientWidth))
    }
    measure()
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setActiveDay(null), [model.month])

  const { actual, projected, axis, period } = model
  const height = 220
  const margin = { left: 38, right: 18, top: 22, bottom: 30 }
  const bottom = height - margin.bottom
  const x = day => margin.left + day / Math.max(1, model.daysInMonth) * (width - margin.left - margin.right)
  const y = value => bottom - (value - axis.min) / (axis.max - axis.min) * (bottom - margin.top)
  const points = [...actual.filter(point => point.day > 0), ...projected.slice(1)]
  const selected = points.find(point => point.day === activeDay)
  const isEstimate = selected && selected.day > model.elapsedDays
  const lastActual = actual.at(-1)
  const lastProjected = projected.at(-1)
  const headline = model.projectedNetGrowth
  const headlineLabel = period === 'past' ? 'Resultado neto del período' : 'Crecimiento estimado al cierre'
  const ticks = [...new Set(width < 380 ? [1, 15, model.daysInMonth] : [1, 8, 15, 22, model.daysInMonth])]
  const showChart = period === 'past' || period === 'current'
  const moveFocus = (event, index) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setActiveDay(points[index].day)
      return
    }
    const next = event.key === 'ArrowRight' ? Math.min(points.length - 1, index + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null
    if (event.key === 'Escape') setActiveDay(null)
    if (next === null) return
    event.preventDefault()
    plot.current?.querySelector(`[data-day="${points[next].day}"]`)?.focus()
  }

  return <article className="data-card dashboard-chart-card net-projection-card" aria-labelledby={`${id}-title`}>
    <header className="dashboard-chart-heading">
      <p className="eyebrow">PROYECCIÓN NETA DE ABONADOS</p>
      <h2 id={`${id}-title`}>{headlineLabel}</h2>
      <p className="dashboard-chart-period">{periodLabel}</p>
    </header>
    <div className="net-projection-summary">
      <div className="net-projection-headline">
        <strong className={headline < 0 ? 'is-negative' : ''}>{headline === null ? '—' : signed(headline)}</strong>
        <span>{period === 'past' ? 'abonados netos al cierre' : 'abonados netos estimados'}</span>
      </div>
      {showChart && <div className="net-projection-current"><span>{period === 'past' ? 'Balance del mes' : 'Neto confirmado'}</span><b>{signed(model.netGrowth)}</b><small>{quantity(model.installations)} altas − {quantity(model.retirements)} bajas</small></div>}
    </div>
    <div className="net-projection-plot" ref={plot} onPointerLeave={() => {
      if (!plot.current?.contains(document.activeElement)) setActiveDay(null)
    }}>
      {showChart ? <svg className="net-projection-svg" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-labelledby={`${id}-title ${id}-description`}>
        <desc id={`${id}-description`}>Saldo acumulado de altas menos bajas de alarma. Línea continua: resultado confirmado. Línea punteada: estimación hasta el cierre del mes.</desc>
        <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--insight-net)" stopOpacity=".23" /><stop offset="100%" stopColor="var(--insight-net)" stopOpacity=".02" /></linearGradient></defs>
        <text className="insight-axis" x={margin.left} y="12">Abonados netos</text>
        {axis.ticks.map(value => <g key={value}><line className={`insight-grid${value === 0 ? ' insight-zero' : ''}`} x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="insight-axis" x={margin.left - 9} y={y(value)} dy=".35em" textAnchor="end">{quantity(value)}</text></g>)}
        {ticks.map(day => <text className="insight-axis" key={day} x={x(day)} y={height - 8} textAnchor={day === model.daysInMonth ? 'end' : 'middle'}>{day} {width < 380 ? '' : monthName(model.month).slice(0, 3)}</text>)}
        {lastActual && <path d={`${linePath(actual, x, y)} L${x(lastActual.day)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id}-fill)`} />}
        <path className="net-line net-line-actual" d={linePath(actual, x, y)} />
        {projected.length > 1 && <path className="net-line net-line-estimated" d={linePath(projected, x, y)} />}
        {lastActual && <circle className="net-point" cx={x(lastActual.day)} cy={y(lastActual.value)} r="4.5" />}
        {lastProjected && <circle className="net-point net-point-estimated" cx={x(lastProjected.day)} cy={y(lastProjected.value)} r="4.5" />}
        {selected && <g><line className="insight-crosshair" x1={x(selected.day)} x2={x(selected.day)} y1={margin.top} y2={bottom} /><circle className={`net-point${isEstimate ? ' net-point-estimated' : ''}`} cx={x(selected.day)} cy={y(selected.value)} r="5" /></g>}
        {points.map((point, index) => <rect key={point.day} data-day={point.day} className="insight-hit-target"
          x={x(point.day - .5)} y={margin.top} width={(width - margin.left - margin.right) / model.daysInMonth} height={bottom - margin.top}
          fill="transparent" role="button" tabIndex={point.day === (activeDay ?? model.elapsedDays) ? 0 : -1}
          aria-label={`${dayLabel(point)}: ${signed(point.value)} abonados netos ${point.day > model.elapsedDays ? 'estimados' : 'confirmados'}`}
          onPointerEnter={() => setActiveDay(point.day)} onClick={() => setActiveDay(point.day)} onFocus={() => setActiveDay(point.day)}
          onBlur={event => { if (!plot.current?.contains(event.relatedTarget)) setActiveDay(null) }}
          onKeyDown={event => moveFocus(event, index)} />)}
      </svg> : <div className="dashboard-chart-empty"><strong>El período todavía no comenzó</strong><span>La proyección estará disponible con los resultados del mes.</span></div>}
      {selected && <div className="net-projection-tooltip" role="status"><span>{dayLabel(selected)} · {isEstimate ? 'Estimado' : 'Confirmado'}</span><b>{signed(selected.value)} abonados</b></div>}
    </div>
    <div className="net-projection-legend" aria-label="Referencias de la proyección"><span><i />Neto confirmado</span>{period !== 'past' && <span><i className="estimated" />Estimación al cierre</span>}</div>
    <footer className="dashboard-chart-footer">
      <p>{period === 'past' ? 'Mes cerrado · resultado confirmado.' : period === 'current'
        ? model.elapsedBusinessDays ? `${model.elapsedBusinessDays} de ${model.businessDays} días hábiles · promedio neto: ${decimal(model.dailyAverage)} por día.`
          : 'La estimación estará disponible después del primer día hábil.'
        : 'Sin proyección disponible para un mes futuro.'}
        {period === 'current' && <small>Estimación al ritmo actual, de lunes a viernes, sin ajuste por feriados.</small>}
      </p>
      {model.variation !== null && <p className="net-projection-comparison"><strong className={`projection-variation ${model.variation >= 0 ? 'positive' : 'negative'}`}>{signed(model.variation)}%</strong> vs. {monthName(model.previousMonth)}{period === 'current' ? ' (cierre estimado)' : ''}</p>}
    </footer>
    <table className="dashboard-chart-data"><caption>Saldo neto diario de {periodLabel}</caption><thead><tr><th scope="col">Día</th><th scope="col">Abonados netos</th><th scope="col">Tipo</th></tr></thead><tbody>{points.map(point => <tr key={point.day}><th scope="row">{dayLabel(point)}</th><td>{point.value}</td><td>{point.day > model.elapsedDays ? 'Estimado' : 'Confirmado'}</td></tr>)}</tbody></table>
  </article>
}

export function WorkCompositionChart({ model, periodLabel }) {
  const id = `work-${useId().replaceAll(':', '')}`
  const [selected, setSelected] = useState(null)
  const [hovered, setHovered] = useState(null)
  const activeName = hovered ?? selected
  const active = model.items.find(item => item.name === activeName)
  const circumference = 2 * Math.PI * 76
  const workLabel = model.workCount === 1 ? 'trabajo' : 'trabajos'
  let offset = 0
  const arcs = model.items.map((item, index) => {
    const start = offset
    offset += item.share * circumference
    return { ...item, index, start, length: item.share * circumference }
  })
  useEffect(() => { setSelected(null); setHovered(null) }, [periodLabel])

  return <article className="data-card dashboard-chart-card work-composition-card" aria-labelledby={`${id}-title`}>
    <header className="dashboard-chart-heading">
      <p className="eyebrow">TRABAJOS COMPLETADOS</p>
      <h2 id={`${id}-title`}>Composición del período</h2>
      <p className="dashboard-chart-period">{periodLabel} · {quantity(model.workCount)} {workLabel} {model.workCount === 1 ? 'completado' : 'completados'}</p>
    </header>
    <div className="work-composition-content">
      <div className="work-composition-donut">
        <svg className="work-composition-svg" viewBox="0 0 200 200" role="img" aria-labelledby={`${id}-title ${id}-description`} onPointerLeave={() => setHovered(null)}>
          <desc id={`${id}-description`}>{model.workCount} {workLabel} {model.workCount === 1 ? 'completado' : 'completados'}{model.hasMultipleServices ? ` con ${model.serviceCount} prestaciones` : ''}. Las cantidades y porcentajes por tipo se detallan en la leyenda.</desc>
          <circle className="work-donut-track" cx="100" cy="100" r="76" fill="none" strokeWidth="26" />
          <g transform="rotate(-90 100 100)">{arcs.map(item => <circle key={item.name} className={`work-donut-segment${active && active.name !== item.name ? ' is-muted' : ''}`}
            style={{ '--slice-color': `var(--insight-slice-${item.index % 8})` }} cx="100" cy="100" r="76" fill="none" strokeWidth={active?.name === item.name ? 32 : 26}
            strokeDasharray={`${Math.max(.1, item.length - (arcs.length > 1 ? 2 : 0))} ${circumference}`}
            strokeDashoffset={-item.start} onPointerEnter={() => setHovered(item.name)}>
            <title>{item.name}: {quantity(item.count)} ({decimal(item.percentage)}%)</title>
          </circle>)}</g>
          <text className="work-donut-total" x="100" y="99" textAnchor="middle">{quantity(active?.count ?? (model.hasMultipleServices ? model.serviceCount : model.workCount))}</text>
          <text className="work-donut-caption" x="100" y="121" textAnchor="middle">{active ? `${decimal(active.percentage)}% del total` : model.hasMultipleServices ? 'prestaciones' : workLabel}</text>
        </svg>
      </div>
      {model.items.length ? <ul className="work-composition-legend" aria-label="Tipos de servicio">{model.items.map((item, index) => <li key={item.name}>
        <button type="button" className={active?.name === item.name ? 'is-highlighted' : ''} aria-pressed={selected === item.name}
          title={`Destacar ${item.name}`} style={{ '--slice-color': `var(--insight-slice-${index % 8})` }}
          onPointerEnter={() => setHovered(item.name)} onPointerLeave={() => setHovered(null)}
          onClick={() => setSelected(current => current === item.name ? null : item.name)}>
          <i aria-hidden="true" /><span>{item.name}</span><b>{quantity(item.count)}</b><small>{decimal(item.percentage)}%</small>
        </button>
      </li>)}</ul> : <div className="dashboard-chart-empty"><strong>Sin trabajos completados</strong><span>Los resultados de este mes aparecerán aquí.</span></div>}
    </div>
    <footer className="dashboard-chart-footer"><p>{model.hasMultipleServices
      ? `${quantity(model.serviceCount)} prestaciones en ${quantity(model.workCount)} ${workLabel}. Un trabajo puede incluir varios tipos; los porcentajes corresponden a las prestaciones.`
      : 'Distribución de los trabajos completados por tipo de servicio.'}</p></footer>
  </article>
}
