import React, { useMemo, useState } from 'react'
import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import { isAlarmInstallationRecord } from '../../../domain/services/installation-metrics.mjs'
import { isEquipmentRetirementRecord } from '../../../domain/services/equipment-retirement.mjs'
import { annualChartMonths } from '../../../domain/dashboard/annual-chart-model.mjs'
import { dashboardNetProjection, buildWorkComposition } from '../../../domain/dashboard/dashboard-insights.mjs'
import { triggerBrowserDownload, reportDownloadName } from '../../../infrastructure/browser/browser-download.mjs'
import { serviceTypesLabel } from '../../../domain/services/multi-service.mjs'
import ModuleIntroduction from '../../../components/ModuleIntroduction.jsx'
import AnnualEvolutionChart from '../../../components/AnnualEvolutionChart.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import LocationInstallationsModal from '../../../components/LocationInstallationsModal.jsx'
import { retirementClientLabel } from '../../../domain/customers/retirement-label.mjs'
import { currentLocalDate, prettyDate } from '../../../presentation/formatting.mjs'
import { NetProjectionChart, WorkCompositionChart } from './DashboardInsights.jsx'

const zones = [['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residenciales']]
const zoneOf = record => record.installationZone || (`${record.address || ''} ${record.client || ''}`.toLowerCase().includes('docta') ? 'docta' : `${record.address || ''} ${record.client || ''}`.toLowerCase().includes('nobu') ? 'nobu-town' : 'residencial')

export default function DashboardStatusView({ history = [], services = [] }) {
  const { can } = useActionPermissions()
  const canDetail = can('dashboard.detail')
  const canExport = can('records.export')
  const [locationDetail, setLocationDetail] = useState(null)
  const [retirementModalOpen, setRetirementModalOpen] = useState(false)
  const [month, setMonth] = useState(() => currentLocalDate().slice(0, 7))
  const todayKey = currentLocalDate()
  const year = month.slice(0, 4)
  const periodLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const { alarms, retirements, months, projection, composition } = useMemo(() => {
    const records = history.filter(record => record.date?.startsWith(month) && record.date <= todayKey && record.status === 'Completado').sort((a, b) => b.date.localeCompare(a.date))
    const isAlarmRecord = record => isAlarmInstallationRecord(record, services)
    const options = { month, year, today: todayKey, isAlarmRecord, zoneOf, isRetirementRecord: isEquipmentRetirementRecord }
    return {
      alarms: records.filter(record => isAlarmRecord(record) && zoneOf(record) !== 'no-monitoreada'),
      retirements: records.filter(isEquipmentRetirementRecord),
      months: annualChartMonths(history, options),
      projection: dashboardNetProjection(history, options),
      composition: buildWorkComposition(records)
    }
  }, [history, services, month, year, todayKey])
  const download = (category, format = 'excel') => {
    if (!canExport) return
    const href = `/api/history/export?month=${encodeURIComponent(month)}&category=${encodeURIComponent(category)}&format=${encodeURIComponent(format)}`
    triggerBrowserDownload(href, reportDownloadName(month, category, format))
  }
  const reportActions = (category, open, label) => <>
    {canDetail && <button title={`Consultá ${label}.`} type="button" className="secondary" aria-label={`Ver ${label}`} onClick={open}><Icon name="eye" size={15} />Ver</button>}
    {canExport && <button title="Descargá los registros de este listado en un archivo de Excel." type="button" className={`secondary${category === 'all' ? ' all-alarms-export' : ''}`} onClick={() => download(category)}><Icon name="upload" size={15} />Excel</button>}
    {canExport && <button title="Descargá los registros de este listado en un archivo PDF." type="button" className="secondary" onClick={() => download(category, 'pdf')}><Icon name="upload" size={15} />PDF</button>}
  </>

  return <div className="dashboard-overview">
    <div className="module-intro">
      <ModuleIntroduction><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Las métricas contabilizan únicamente servicios completados.</p></ModuleIntroduction>
      <label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value) }} /></label>
    </div>
    <div className="dashboard-overview-charts">
      <NetProjectionChart model={projection} periodLabel={periodLabel} />
      <WorkCompositionChart model={composition} periodLabel={periodLabel} />
    </div>
    <AnnualEvolutionChart months={months} year={year} />
    <div className="dashboard-detail-grid">
      <article className="data-card zone-summary">
        <p className="eyebrow">ALTAS DE SERVICIO</p><h2>Detalle por ubicación</h2>
        <div><span>Todas las instalaciones</span><b>{alarms.length}</b>{reportActions('all', () => setLocationDetail('all'), 'todas las instalaciones')}</div>
        {zones.map(([key, label]) => <div key={key}><span>{label}</span><b>{alarms.filter(record => zoneOf(record) === key).length}</b>{reportActions(key, () => setLocationDetail(key), `instalaciones de ${label}`)}</div>)}
      </article>
      <article className="data-card zone-summary retirement-summary">
        <p className="eyebrow">BAJAS DE SERVICIO</p><h2>Retiros de alarma</h2>
        <div><span>Todos los retiros</span><b>{retirements.length}</b>{reportActions('retirements', () => setRetirementModalOpen(true), 'bajas de servicio')}</div>
      </article>
    </div>
    {canDetail && locationDetail && <LocationInstallationsModal records={alarms} category={locationDetail} label={locationDetail === 'all' ? 'Todas las instalaciones' : zones.find(([key]) => key === locationDetail)?.[1]} month={month} zoneOf={zoneOf} close={() => setLocationDetail(null)} />}
    {canDetail && retirementModalOpen && <RetirementDetailsModal records={retirements} month={month} close={() => setRetirementModalOpen(false)} download={download} />}
  </div>
}

function RetirementDetailsModal({ records, month, close, download }) {
  const { can } = useActionPermissions()
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalle de bajas de servicio"><div className="modal alarm-details-modal retirement-details-modal"><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="close-modal" onClick={close} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">BAJAS DE SERVICIO</p><h2>{records.length} retiro{records.length === 1 ? '' : 's'} de alarma en {monthName}</h2><p>Estos registros se descuentan de las nuevas instalaciones para calcular el crecimiento neto real.</p><div className="alarm-details-list">{records.length ? records.map(record => <article key={record.id}><div><b>{retirementClientLabel(record)}</b><small>{prettyDate(record.date)}{record.time ? ` · ${record.time} Hs` : ''}</small></div><div className="alarm-detail-data"><span><b>Servicio:</b> {serviceTypesLabel(record)}</span>{can('records.contact') && <span><b>Dirección:</b> {record.address || 'Sin dirección'}</span>}<span><b>Técnicos:</b> {record.technicians?.join(' / ') || 'Sin asignar'}</span>{record.detail && <span><b>Detalle:</b> {record.detail}</span>}</div></article>) : <div className="empty-state">No hay bajas de servicio completadas para este período.</div>}</div><div className="modal-actions">{can('records.export') && <button title="Descargá el listado completo de retiros de equipo en Excel." className="secondary" onClick={() => download('retirements')}><Icon name="upload" size={16} />Descargar Excel completo</button>}{can('records.export') && <button title="Descargá el listado completo de retiros de equipo en PDF." className="secondary" onClick={() => download('retirements', 'pdf')}><Icon name="upload" size={16} />Descargar PDF completo</button>}<button title="Cerrá esta ventana y volvé a la pantalla anterior." className="primary" onClick={close}><Icon name="close" size={16} />Cerrar</button></div></div></div>
}
