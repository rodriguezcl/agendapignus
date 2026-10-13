import React from 'react'
import { mileageStatistics } from '../domain/vehicles/mileage-statistics.mjs'
export default function VehicleMileageStats({ history, vehicleId, today }) {
 const stats = mileageStatistics(history, vehicleId, today)
 const km = value => Math.round(value).toLocaleString('es-AR')
 const maximum = Math.max(1, ...stats.rows.map(row => row.km))
 return <section className="vehicle-mileage-stats"><h3>Kilómetros por mes</h3><p><strong>{stats.average == null ? 'Promedio aún no disponible' : km(stats.average) + ' km/mes en promedio'}</strong></p><p>Estimación proporcional entre controles. Promedio de {stats.completeMonths} meses completos con cobertura; excluye el mes actual.</p>{!stats.rows.length && <p>Se necesitan al menos dos controles con kilometrajes válidos en fechas diferentes.</p>}{stats.rows.map(row => <div className="mileage-month" key={row.month}><div><strong>{new Date(row.month + '-01T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</strong><span>{km(row.km)} km · {row.complete ? 'Mes completo' : 'Parcial · ' + row.days + ' días'}</span></div><meter min="0" max={maximum} value={row.km} aria-label={'Kilómetros estimados de ' + row.month} /></div>)}{stats.warnings > 0 && <p role="status">Hay {stats.warnings} lecturas inconsistentes (descensos o valores distintos en una misma fecha). Se excluyeron los intervalos afectados; revisá esos controles.</p>}</section>
}
