import React from 'react'
import { useState, useEffect } from "react";
import { isAlarmInstallationRecord, isInstallationRecord } from "../../../domain/services/installation-metrics.mjs";
import { isEquipmentRetirementRecord } from "../../../domain/services/equipment-retirement.mjs";
import { countYearToDateAlarmInstallations, countYearToDateCompletedRecords } from "../../../domain/dashboard/dashboard-metrics.mjs";
import { annualChartMonths } from "../../../domain/dashboard/annual-chart-model.mjs";
import { triggerBrowserDownload, reportDownloadName } from "../../../infrastructure/browser/browser-download.mjs";
import { serviceTypesFor, serviceTypesLabel } from "../../../domain/services/multi-service.mjs";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import AnnualEvolutionChart from "../../../components/AnnualEvolutionChart.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import LocationInstallationsModal from "../../../components/LocationInstallationsModal.jsx";
import { retirementClientLabel } from "../../../domain/customers/retirement-label.mjs";
import { currentLocalDate, prettyDate } from '../../../presentation/formatting.mjs'

export default function DashboardStatusView({ history, services, vehicles = [], customers = [] }) {
  const [locationDetail, setLocationDetail] = useState(null)
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [alarmModalOpen, setAlarmModalOpen] = useState(false)
  const [retirementModalOpen, setRetirementModalOpen] = useState(false)
  const [projectionModalOpen, setProjectionModalOpen] = useState(false)
  const [workModalOpen, setWorkModalOpen] = useState(false)
  const year = month.slice(0, 4)
  const isComplete = record => record.status === 'Completado'
  const records = history.filter(record => record.date?.startsWith(month) && isComplete(record)).sort((a, b) => b.date.localeCompare(a.date))
  const isAlarmRecord = record => isAlarmInstallationRecord(record, services)
  const zoneOf = record => record.installationZone || (`${record.address || ''} ${record.client || ''}`.toLowerCase().includes('docta') ? 'docta' : `${record.address || ''} ${record.client || ''}`.toLowerCase().includes('nobu') ? 'nobu-town' : 'residencial')
  const installations = records.filter(record => isInstallationRecord(record, services))
  const alarms = installations.filter(record => isAlarmRecord(record) && zoneOf(record) !== 'no-monitoreada')
  const isRetirementRecord = isEquipmentRetirementRecord
  const retirements = records.filter(isRetirementRecord)
  const netGrowth = alarms.length - retirements.length
  const zones = [['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residenciales']]
  const todayKey = currentLocalDate()
  const currentYear = todayKey.slice(0, 4)
  const annualLocationTotals = Object.fromEntries(zones.map(([key]) => [key, countYearToDateAlarmInstallations(history, { throughDate: todayKey, zone: key, isAlarmRecord, zoneOf })]))
  const annualRetirements = countYearToDateCompletedRecords(history, { throughDate: todayKey, matches: isRetirementRecord })
  const months = annualChartMonths(history, { year, today: todayKey, isAlarmRecord, zoneOf, isRetirementRecord })
  const download = (category, format = 'excel') => {
    const href = `/api/history/export?month=${encodeURIComponent(month)}&category=${encodeURIComponent(category)}&format=${encodeURIComponent(format)}`
    triggerBrowserDownload(href, reportDownloadName(month, category, format))
  }
  const serviceBreakdown = Object.entries(records.reduce((summary, record) => { for (const type of serviceTypesFor(record)) { const name = type.name?.trim() || 'Sin especificar'; summary[name] = (summary[name] || 0) + 1; } return summary }, {})).sort(([, left], [, right]) => right - left)
  const [selectedYear, selectedMonth] = month.split('-').map(Number)
  const today = new Date()
  const isCurrentPeriod = today.getFullYear() === selectedYear && today.getMonth() + 1 === selectedMonth
  const businessDaysInPeriod = countBusinessDays(selectedYear, selectedMonth)
  const elapsedBusinessDays = isCurrentPeriod ? countBusinessDays(selectedYear, selectedMonth, today.getDate()) : businessDaysInPeriod
  const projectedInstallations = elapsedBusinessDays ? Math.round(netGrowth / elapsedBusinessDays * businessDaysInPeriod) : 0
  const previousDate = new Date(selectedYear, selectedMonth - 2, 1)
  const previousMonthKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`
  const previousInstallations = history.filter(record => record.date?.startsWith(previousMonthKey) && isComplete(record) && isAlarmRecord(record) && zoneOf(record) !== 'no-monitoreada').length
  const previousRetirements = history.filter(record => record.date?.startsWith(previousMonthKey) && isComplete(record) && isRetirementRecord(record)).length
  const previousNetGrowth = previousInstallations - previousRetirements
  const comparisonValue = isCurrentPeriod ? projectedInstallations : netGrowth
  const variation = previousNetGrowth ? Math.round((comparisonValue - previousNetGrowth) / Math.abs(previousNetGrowth) * 100) : null
  const previousMonthLabel = previousDate.toLocaleDateString('es-AR', { month: 'long' })
  const yearToDateInstallations = history.filter(record => record.date?.startsWith(`${selectedYear}-`) && Number(record.date.slice(5, 7)) <= selectedMonth && isComplete(record) && isAlarmRecord(record) && zoneOf(record) !== 'no-monitoreada').length
  const yearToDateRetirements = history.filter(record => record.date?.startsWith(`${selectedYear}-`) && Number(record.date.slice(5, 7)) <= selectedMonth && isComplete(record) && isRetirementRecord(record)).length
  const averageInstallations = (yearToDateInstallations - yearToDateRetirements) / selectedMonth
  const averageValue = Math.round(averageInstallations)
  const averageVariation = averageInstallations ? Math.round((comparisonValue - averageInstallations) / averageInstallations * 100) : null
  useEffect(() => {
    const stats = document.querySelector('.stats-grid')
    if (!stats) return
    const cards = [...stats.querySelectorAll(':scope > article')]
    const projectionCard = cards.find(card => {
      const title = card.querySelector('span')?.textContent || ''
      return title.includes('Instalaciones') || title.includes('Proyección') || title.includes('Crecimiento neto')
    })
    const alarmsCard = cards.find(card => card.querySelector('span')?.textContent.includes('Altas'))
    if (!projectionCard || !alarmsCard) return
    stats.prepend(alarmsCard)
    projectionCard.querySelector('span').textContent = isCurrentPeriod ? 'Crecimiento neto del mes' : 'Crecimiento neto del período'
    projectionCard.querySelector('b').textContent = `${netGrowth > 0 ? '+' : ''}${netGrowth}`
    const comparison = variation === null ? `Sin crecimiento neto comparable en ${previousMonthLabel}` : `<strong class="projection-variation ${variation >= 0 ? 'positive' : 'negative'}">${variation > 0 ? '+' : ''}${variation}%</strong> vs. ${previousMonthLabel}`
    const averageComparison = averageVariation === null ? 'Sin promedio neto anual disponible' : `<strong class="projection-variation ${averageVariation >= 0 ? 'positive' : 'negative'}">${averageVariation > 0 ? '+' : ''}${averageVariation}%</strong> vs. promedio neto mensual ${selectedYear} (${averageValue})`
    projectionCard.querySelector('small').innerHTML = isCurrentPeriod
      ? `<span>${variation === null ? `Sin comparación disponible vs. ${previousMonthLabel}` : `<strong class="projection-variation ${variation >= 0 ? 'positive' : 'negative'}">${variation > 0 ? '+' : ''}${variation}%</strong> vs. ${previousMonthLabel}`}</span><br><span>${averageVariation === null ? 'Sin promedio anual disponible' : `<strong class="projection-variation ${averageVariation >= 0 ? 'positive' : 'negative'}">${averageVariation > 0 ? '+' : ''}${averageVariation}%</strong> vs. promedio neto mensual ${selectedYear} (${averageValue})`}</span>`
      : 'Resultado final del período'
  }, [month, netGrowth, isCurrentPeriod, variation, averageVariation, previousMonthLabel, selectedYear, averageValue])
  useEffect(() => {
    // Las tarjetas se vuelven accesibles por mouse y teclado una vez ordenadas por el resumen.
    const stats = document.querySelector('.stats-grid')
    if (!stats) return undefined
    const cards = [...stats.querySelectorAll(':scope > article')]
    const projectionCard = cards.find(card => {
      const title = card.querySelector('span')?.textContent || ''
      return title.includes('Proyección') || title.includes('Crecimiento neto')
    })
    const workCard = cards.find(card => card.querySelector('span')?.textContent.includes('Trabajos'))
    const bind = (card, open, label) => {
      if (!card) return () => {}
      card.classList.add('clickable-stat')
      card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', label)
      const keyboard = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }
      card.addEventListener('click', open); card.addEventListener('keydown', keyboard)
      return () => { card.removeEventListener('click', open); card.removeEventListener('keydown', keyboard) }
    }
    const unbindProjection = bind(projectionCard, () => setProjectionModalOpen(true), 'Ver detalle de proyección de alarmas')
    const unbindWorks = bind(workCard, () => setWorkModalOpen(true), 'Ver composición de trabajos completados')
    return () => { unbindProjection(); unbindWorks() }
  }, [month, projectedInstallations, records.length])
  useEffect(() => {
    if (!projectionModalOpen) return undefined
    const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const dailyAverage = elapsedBusinessDays ? (netGrowth / elapsedBusinessDays).toFixed(1).replace('.', ',') : '0'
    const progress = projectedInstallations > 0 ? Math.min(100, Math.round(Math.max(0, netGrowth) / projectedInstallations * 100)) : 0
    const layer = document.createElement('div'); layer.className = 'modal-layer dashboard-insight-layer'
    const modal = document.createElement('div'); modal.className = 'modal dashboard-insight-modal projection-insight-modal'
    modal.innerHTML = `<button title="Cerrá este informe y volvé al resumen." class="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">PROYECCIÓN NETA DE ABONADOS</p><h2>${isCurrentPeriod ? 'Crecimiento estimado al cierre' : 'Resultado neto del período'}</h2><p class="insight-period">${monthName}</p><div class="projection-highlight"><b>${projectedInstallations}</b><span>${isCurrentPeriod ? 'crecimiento neto proyectado' : 'crecimiento neto confirmado'}</span></div><div class="projection-progress"><span style="width:${progress}%"></span></div><p class="projection-progress-label">Crecimiento actual: ${alarms.length} altas menos ${retirements.length} bajas = ${netGrowth}<br><small>Proyección calculada sobre ${elapsedBusinessDays} de ${businessDaysInPeriod} días hábiles (lunes a viernes).</small></p><div class="insight-metrics"><article><b>${alarms.length}</b><span>Nuevas alarmas</span></article><article><b>${retirements.length}</b><span>Bajas de servicio</span></article><article><b>${dailyAverage}</b><span>Promedio neto por día hábil</span></article><article><b class="${variation === null || variation >= 0 ? 'positive' : 'negative'}">${variation === null ? '—' : `${variation > 0 ? '+' : ''}${variation}%`}</b><span>Vs. crecimiento neto de ${previousMonthLabel}</span></article></div><div class="modal-actions"><button title="Cerrá este informe y volvé al resumen." class="primary"><Icon name="close" size={16} />Cerrar</button></div>`
    const close = () => setProjectionModalOpen(false)
    modal.querySelectorAll('button').forEach(button => { button.onclick = close })
    layer.onclick = event => { if (event.target === layer) close() }
    layer.append(modal); document.body.append(layer)
    return () => layer.remove()
  }, [projectionModalOpen, month, alarms.length, retirements.length, netGrowth, projectedInstallations, elapsedBusinessDays, businessDaysInPeriod, variation, previousMonthLabel, isCurrentPeriod])
  useEffect(() => {
    if (!workModalOpen) return undefined
    const palette = ['#2f69ad', '#218857', '#c4870a', '#8a57b6', '#c4534b', '#257c82', '#a76424', '#68786d']
    const total = Math.max(1, records.length)
    let offset = 0
    const slices = serviceBreakdown.map(([name, count], index) => {
      const start = offset; offset += count / total * 100
      return `${palette[index % palette.length]} ${start}% ${offset}%`
    }).join(', ')
    const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const layer = document.createElement('div'); layer.className = 'modal-layer dashboard-insight-layer'
    const modal = document.createElement('div'); modal.className = 'modal dashboard-insight-modal work-insight-modal'
    modal.innerHTML = `<button title="Cerrá este informe y volvé al resumen." class="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">TRABAJOS COMPLETADOS</p><h2>Composición del período</h2><p class="insight-period">${records.length} trabajo(s) completado(s) en ${monthName}</p><div class="work-composition"><div class="donut-chart"><span>${records.length}<small>total</small></span></div><div class="donut-legend"></div></div><div class="modal-actions"><button title="Cerrá este informe y volvé al resumen." class="primary"><Icon name="close" size={16} />Cerrar</button></div>`
    modal.querySelector('.donut-chart').style.background = `conic-gradient(${slices || '#dfe7df 0 100%'})`
    const legend = modal.querySelector('.donut-legend')
    serviceBreakdown.forEach(([name, count], index) => {
      const row = document.createElement('div')
      const marker = document.createElement('i'); marker.style.background = palette[index % palette.length]
      const label = document.createElement('span'); label.textContent = name
      const value = document.createElement('b'); value.textContent = `${count} `
      const percentLabel = document.createElement('small'); percentLabel.textContent = `${Math.round(count / total * 100)}%`
      value.append(percentLabel); row.append(marker, label, value); legend.append(row)
    })
    if (!serviceBreakdown.length) legend.textContent = 'No hay trabajos completados para este período.'
    const close = () => setWorkModalOpen(false)
    modal.querySelectorAll('button').forEach(button => { button.onclick = close })
    layer.onclick = event => { if (event.target === layer) close() }
    layer.append(modal); document.body.append(layer)
    return () => layer.remove()
  }, [workModalOpen, month, records.length, serviceBreakdown])
return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Las métricas contabilizan únicamente servicios completados.</p></ModuleIntroduction><label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div><div className="stats-grid dashboard-stats-four"><article className="clickable-stat" role="button" tabIndex={0} onClick={() => setAlarmModalOpen(true)} onKeyDown={event => event.key === 'Enter' && setAlarmModalOpen(true)}><span>Altas de servicio</span><b>{alarms.length}</b><small>Instalaciones de alarmas completadas</small></article><article className="clickable-stat retirement-stat" role="button" tabIndex={0} onClick={() => setRetirementModalOpen(true)} onKeyDown={event => event.key === 'Enter' && setRetirementModalOpen(true)}><span>Bajas de servicio</span><b>{retirements.length}</b><small>Retiros de alarmas completados</small></article><article><span>Proyección neta de abonados</span><b>{projectedInstallations}</b><small>{isCurrentPeriod ? 'Estimación al cierre' : 'Resultado final'} · altas ({alarms.length}) menos bajas ({retirements.length})</small></article><article><span>Trabajos completados</span><b>{records.length}</b><small>Instalaciones y servicios técnicos</small></article></div><section className="annual-kpi-section" aria-labelledby="annual-kpi-title"><div className="annual-kpi-heading"><p className="eyebrow">ACUMULADO ANUAL</p><h2 id="annual-kpi-title">Desde el 1 de enero hasta hoy · {currentYear}</h2></div><div className="stats-grid annual-stats-grid"><article className="docta-ytd-stat"><span>Instalaciones en Docta</span><b>{annualLocationTotals.docta}</b><small>Alarmas completadas</small></article><article className="nobu-ytd-stat"><span>Instalaciones en Nobu Town</span><b>{annualLocationTotals['nobu-town']}</b><small>Alarmas completadas</small></article><article className="residential-ytd-stat"><span>Instalaciones residenciales</span><b>{annualLocationTotals.residencial}</b><small>Alarmas completadas fuera de Docta y Nobu</small></article><article className="retirements-ytd-stat"><span>Bajas de servicio</span><b>{annualRetirements}</b><small>Retiros de alarma completados</small></article></div></section><div className="dashboard-analytics"><AnnualEvolutionChart months={months} year={year} /><div className="dashboard-summary-column"><article className="data-card zone-summary"><p className="eyebrow">ALTAS DE SERVICIO</p><h2>Detalle por ubicación</h2><div><span>Todas las instalaciones</span><b>{alarms.length}</b><button title="Consultá el detalle de todas las instalaciones por ubicación." type="button" className="secondary" onClick={() => setLocationDetail('all')}><Icon name="eye" size={15} />Ver</button><button title="Descargá los registros de este listado en un archivo de Excel." className="secondary all-alarms-export" onClick={() => download('all')}><Icon name="upload" size={15} />Excel</button><button title="Descargá los registros de este listado en un archivo PDF." className="secondary" onClick={() => download('all', 'pdf')}><Icon name="upload" size={15} />PDF</button></div>{zones.map(([key, label]) => <div key={key}><span>{label}</span><b>{alarms.filter(record => zoneOf(record) === key).length}</b><button title="Consultá las instalaciones correspondientes a esta ubicación." type="button" className="secondary" aria-label={`Ver instalaciones de ${label}`} onClick={() => setLocationDetail(key)}><Icon name="eye" size={15} />Ver</button><button title="Descargá los registros de este listado en un archivo de Excel." className="secondary" onClick={() => download(key)}><Icon name="upload" size={15} />Excel</button><button title="Descargá los registros de este listado en un archivo PDF." className="secondary" onClick={() => download(key, 'pdf')}><Icon name="upload" size={15} />PDF</button></div>)}</article><article className="data-card zone-summary retirement-summary"><p className="eyebrow">BAJAS DE SERVICIO</p><h2>Retiros de alarma</h2><div><span>Todos los retiros</span><b>{retirements.length}</b><button title="Consultá las bajas de servicio del mes seleccionado." type="button" className="secondary" aria-label="Ver bajas de servicio" onClick={() => setRetirementModalOpen(true)}><Icon name="eye" size={15} />Ver</button><button title="Descargá el listado completo de retiros de equipo en Excel." className="secondary" onClick={() => download('retirements')}><Icon name="upload" size={15} />Excel</button><button title="Descargá el listado completo de retiros de equipo en PDF." className="secondary" onClick={() => download('retirements', 'pdf')}><Icon name="upload" size={15} />PDF</button></div></article></div></div>{locationDetail && <LocationInstallationsModal records={alarms} category={locationDetail} label={locationDetail === 'all' ? 'Todas las instalaciones' : zones.find(([key]) => key === locationDetail)?.[1]} month={month} zoneOf={zoneOf} close={() => setLocationDetail(null)} />}{alarmModalOpen && <AlarmDetailsModal records={alarms} month={month} close={() => setAlarmModalOpen(false)} download={download} />}{retirementModalOpen && <RetirementDetailsModal records={retirements} month={month} close={() => setRetirementModalOpen(false)} download={download} />}</>
}

function AlarmDetailsModal({ records, month, close, download }) {
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalle de altas de servicio"><div className="modal alarm-details-modal"><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="close-modal" onClick={close} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">ALTAS DE SERVICIO</p><h2>{records.length} instalación{records.length === 1 ? '' : 'es'} de alarma en {monthName}</h2><p>Revisá la información del período o descargá el listado completo.</p><div className="alarm-details-list">{records.length ? records.map(record => <article key={record.id}><div><b>{record.client || 'Cliente sin especificar'}</b><small>{prettyDate(record.date)}{record.time ? ` · ${record.time} Hs` : ''}</small></div><div className="alarm-detail-data"><span><b>Ubicación:</b> {record.address || 'Sin dirección'}</span><span><b>Contacto:</b> {record.phone || 'Sin contacto'}</span><span><b>Técnicos:</b> {record.technicians?.join(' / ') || 'Sin asignar'}</span>{record.detail && <span><b>Detalle:</b> {record.detail}</span>}</div></article>) : <div className="empty-state">No hay instalaciones de alarma completadas para este período.</div>}</div><div className="modal-actions"><button title="Descargá todos los registros del informe en un archivo Excel." className="secondary" onClick={() => download('all')}><Icon name="upload" size={16} />Descargar Excel completo</button><button title="Descargá todos los registros del informe en un archivo PDF." className="secondary" onClick={() => download('all', 'pdf')}><Icon name="upload" size={16} />Descargar PDF completo</button><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="primary" onClick={close}><Icon name="close" size={16} />Cerrar</button></div></div></div>
}

function RetirementDetailsModal({ records, month, close, download }) {
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalle de bajas de servicio"><div className="modal alarm-details-modal retirement-details-modal"><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="close-modal" onClick={close} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">BAJAS DE SERVICIO</p><h2>{records.length} retiro{records.length === 1 ? '' : 's'} de alarma en {monthName}</h2><p>Estos registros se descuentan de las nuevas instalaciones para calcular el crecimiento neto real.</p><div className="alarm-details-list">{records.length ? records.map(record => <article key={record.id}><div><b>{retirementClientLabel(record)}</b><small>{prettyDate(record.date)}{record.time ? ` · ${record.time} Hs` : ''}</small></div><div className="alarm-detail-data"><span><b>Servicio:</b> {serviceTypesLabel(record)}</span><span><b>Dirección:</b> {record.address || 'Sin dirección'}</span><span><b>Técnicos:</b> {record.technicians?.join(' / ') || 'Sin asignar'}</span>{record.detail && <span><b>Detalle:</b> {record.detail}</span>}</div></article>) : <div className="empty-state">No hay bajas de servicio completadas para este período.</div>}</div><div className="modal-actions"><button title="Descargá el listado completo de retiros de equipo en Excel." className="secondary" onClick={() => download('retirements')}><Icon name="upload" size={16} />Descargar Excel completo</button><button title="Descargá el listado completo de retiros de equipo en PDF." className="secondary" onClick={() => download('retirements', 'pdf')}><Icon name="upload" size={16} />Descargar PDF completo</button><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="primary" onClick={close}><Icon name="close" size={16} />Cerrar</button></div></div></div>
}

const countBusinessDays = (year, month, throughDay) => {
  const daysInMonth = new Date(year, month, 0).getDate()
  const lastDay = Math.max(0, Math.min(Number(throughDay ?? daysInMonth), daysInMonth))
  let total = 0
  for (let day = 1; day <= lastDay; day += 1) {
    const weekday = new Date(year, month - 1, day, 12).getDay()
    if (weekday >= 1 && weekday <= 5) total += 1
  }
  return total
}
