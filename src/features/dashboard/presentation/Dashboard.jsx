import { subscriberDistribution } from '../../../domain/dashboard/subscriber-distribution.mjs'
import SubscriberDistributionChart from './SubscriberDistributionChart.jsx'
import React, { useMemo, useState } from 'react'
import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { isAlarmInstallationRecord } from '../../../domain/services/installation-metrics.mjs'
import { isEquipmentRetirementRecord } from '../../../domain/services/equipment-retirement.mjs'
import { annualChartMonths } from '../../../domain/dashboard/annual-chart-model.mjs'
import { dashboardNetProjection, buildWorkComposition } from '../../../domain/dashboard/dashboard-insights.mjs'
import { activeSubscriberCount, subscriberGrowthPercentages } from '../../../domain/dashboard/subscriber-growth.mjs'
import { buildCollectionOverview } from '../../../domain/dashboard/collection-chart-model.mjs'
import { triggerBrowserDownload, reportDownloadName } from '../../../infrastructure/browser/browser-download.mjs'
import ModuleIntroduction from '../../../components/ModuleIntroduction.jsx'
import AnnualEvolutionChart from '../../../components/AnnualEvolutionChart.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import LocationInstallationsModal from '../../../components/LocationInstallationsModal.jsx'
import { currentLocalDate } from '../../../presentation/formatting.mjs'
import { NetProjectionChart, WorkCompositionChart } from './DashboardInsights.jsx'
import CollectionsOverviewChart from './CollectionsOverviewChart.jsx'

const zones = [['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residenciales']]
const zoneOf = record => record.installationZone || (`${record.address || ''} ${record.client || ''}`.toLowerCase().includes('docta') ? 'docta' : `${record.address || ''} ${record.client || ''}`.toLowerCase().includes('nobu') ? 'nobu-town' : 'residencial')

export default function DashboardStatusView({ history = [], services = [], customers = [], onOpenCollections }) {
  const { can } = useActionPermissions()
  const { can: hasPermission, user } = usePermissions()
  const canViewCollections = Boolean(user) && ['dashboard.view', 'collections.view', 'records.financial'].every(hasPermission)
  const canDetail = can('dashboard.detail')
  const canExport = can('records.export')
  const [locationDetail, setLocationDetail] = useState(null)
  const [retirementModalOpen, setRetirementModalOpen] = useState(false)
  const [month, setMonth] = useState(() => currentLocalDate().slice(0, 7))
  const todayKey = currentLocalDate()
  const subscriberCount = useMemo(() => activeSubscriberCount(customers), [customers])
  const distribution = useMemo(() => hasPermission('accounts.view') ? subscriberDistribution(customers) : null, [customers, hasPermission])
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
  const collections = useMemo(() => canViewCollections
    ? buildCollectionOverview(history, { month, today: todayKey, user, customers })
    : null, [canViewCollections, history, month, todayKey, user, customers])
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
      <ModuleIntroduction><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>{canViewCollections ? 'Trabajos completados y estado de cobranzas del período.' : 'Las métricas contabilizan únicamente servicios completados.'}</p></ModuleIntroduction>
      <label className="month-filter"><span>Mes de análisis</span><input type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value) }} /></label>
    </div>
    <div className={`dashboard-block-grid${canViewCollections ? '' : ' without-collections'}`}>
      <NetProjectionChart model={projection} periodLabel={periodLabel} growthReference={projection.period === 'current' && hasPermission('accounts.view') ? subscriberGrowthPercentages({ baseCount: subscriberCount, netGrowth: projection.netGrowth, projectedNetGrowth: projection.projectedNetGrowth }) : null} />
      <WorkCompositionChart model={composition} periodLabel={periodLabel} />
      <AnnualEvolutionChart months={months} year={year} subtitle="Servicios completados por mes" />
      {collections && <CollectionsOverviewChart model={collections} periodLabel={periodLabel} onOpenCollections={onOpenCollections} />}
      <article className="data-card zone-summary">
        <p className="eyebrow">MOVIMIENTOS DEL PERÍODO</p><h2>Altas y bajas de servicio</h2><p className="dashboard-chart-period">{periodLabel} · servicios completados</p>
        <div><span>Todas las instalaciones</span><b>{alarms.length}</b>{reportActions('all', () => setLocationDetail('all'), 'todas las instalaciones')}</div>
        {zones.map(([key, label]) => <div key={key}><span>{label}</span><b>{alarms.filter(record => zoneOf(record) === key).length}</b>{reportActions(key, () => setLocationDetail(key), `instalaciones de ${label}`)}</div>)}
        <div className="combined-retirements"><span>Bajas · retiros de alarma</span><b>{retirements.length}</b>{reportActions('retirements', () => setRetirementModalOpen(true), 'bajas de servicio')}</div>
      </article>
      {distribution && <SubscriberDistributionChart model={distribution} />}
    </div>
    {canDetail && locationDetail && <LocationInstallationsModal records={alarms} category={locationDetail} label={locationDetail === 'all' ? 'Todas las instalaciones' : zones.find(([key]) => key === locationDetail)?.[1]} month={month} zoneOf={zoneOf} close={() => setLocationDetail(null)} />}
    {canDetail && retirementModalOpen && <LocationInstallationsModal records={retirements} retirements label="Retiros de alarma" month={month} close={() => setRetirementModalOpen(false)} />}
  </div>
}
