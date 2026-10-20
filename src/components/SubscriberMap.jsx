import { useActionPermissions } from '../presentation/hooks/useActionPermissions.mjs'
import React, { lazy, Suspense, useMemo, useState } from 'react'
import ModuleIntroduction from './ModuleIntroduction.jsx'
import Icon from './ui/Icon.jsx'
import { filterSubscriberMap, subscriberMapRows, MAP_ZONES, MAP_QUALITY } from '../domain/customers/subscriber-map.mjs'
import { metadata as redZonesMetadata } from '../domain/maps/red-zones.json'
import './subscriber-map.css'

const MapCanvas = lazy(() => import('./SubscriberMapCanvas.jsx'))
const options = (rows, field) => [...new Set(rows.map(row => row[field]))].sort((a, b) => a.localeCompare(b, 'es'))
const initialFilters = { search: '', zone: '', city: '', neighborhood: '', quality: '' }

export default function SubscriberMap({ customers, onOpenCustomer }) {
  const { can } = useActionPermissions()
  const [filters, setFilters] = useState(initialFilters), [mode, setMode] = useState('heat'), [selectedKey, setSelectedKey] = useState(null), [page, setPage] = useState(1), [fitRequest, setFitRequest] = useState(0)
  const zonesMode = mode === 'zones'
  const rows = useMemo(() => subscriberMapRows(customers), [customers])
  const scoped = useMemo(() => filterSubscriberMap(rows, { ...filters, quality: '' }), [rows, filters])
  const filtered = useMemo(() => filterSubscriberMap(rows, filters), [rows, filters])
  const located = useMemo(() => filtered.filter(row => row.coordinates), [filtered])
  const selected = filtered.find(row => row.key === selectedKey)
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pages)
  const pending = scoped.filter(row => !row.coordinates).length
  const references = scoped.filter(row => row.coordinates && row.quality !== 'coordinates').length
  const cities = options(filterSubscriberMap(rows, { zone: filters.zone }), 'city')
  const neighborhoods = options(filterSubscriberMap(rows, { zone: filters.zone, city: filters.city }), 'neighborhood')
  const update = (key, value) => { setFilters(old => ({ ...old, [key]: value, ...(key === 'zone' ? { city: '', neighborhood: '' } : key === 'city' ? { neighborhood: '' } : {}) })); setSelectedKey(null); setPage(1) }
  const selectRow = row => { setSelectedKey(row.key); if (row.coordinates) setMode('points') }
  return <div className="subscriber-map-module">
    <ModuleIntroduction><h1>Mapa</h1><p>Explorá la presencia de abonados y consultá las zonas rojas del mapa de referencia.</p></ModuleIntroduction>
    {!zonesMode && <><div className="subscriber-map-metrics" aria-label="Calidad de las ubicaciones en el área filtrada">
      <article><span>Abonados en el padrón</span><strong>{scoped.length}</strong><small>Sólo abonados vigentes según padrón</small></article>
      <article><span>Ubicados</span><strong>{scoped.length - pending}</strong><small>{scoped.length ? Math.round((scoped.length - pending) / scoped.length * 100) : 0}% del área filtrada</small></article>
      <article><span>Ubicaciones de referencia</span><strong>{references}</strong><small>De manzana, aproximadas o genéricas</small></article>
      <article><span>Pendientes de ubicar</span><strong>{pending}</strong><button title="Filtrá los abonados que todavía no tienen una ubicación disponible." type="button" onClick={() => update('quality', 'missing')}>Revisar ubicaciones</button></article>
    </div>
    <div className="subscriber-map-filters">
      <label>Buscar abonado<input type="search" value={filters.search} onChange={event => update('search', event.target.value)} placeholder="Nombre, cuenta o dirección" /></label>
      <label>Zona<select value={filters.zone} onChange={event => update('zone', event.target.value)}><option value="">Todas las zonas</option>{Object.entries(MAP_ZONES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Localidad<select value={filters.city} onChange={event => update('city', event.target.value)}><option value="">Todas las localidades</option>{cities.map(city => <option key={city}>{city}</option>)}</select></label>
      <label>Barrio<select value={filters.neighborhood} onChange={event => update('neighborhood', event.target.value)}><option value="">Todos los barrios</option>{neighborhoods.map(neighborhood => <option key={neighborhood}>{neighborhood}</option>)}</select></label>
      <label>Ubicación<select value={filters.quality} onChange={event => update('quality', event.target.value)}><option value="">Todas las ubicaciones</option><option value="located">Ubicadas en el mapa</option>{Object.entries(MAP_QUALITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button title="Restablecé los filtros y mostrá todos los abonados." type="button" className="secondary" onClick={() => { setFilters(initialFilters); setSelectedKey(null); setPage(1); setFitRequest(value => value + 1) }}>Limpiar filtros</button>
    </div></>}
    <section className={`subscriber-map-workspace${zonesMode ? ' is-zones' : ''}`} aria-label="Explorador geográfico">
      <div className="subscriber-map-main">
        <div className="subscriber-map-toolbar">
          <div role="group" aria-label="Vista del mapa">{[['heat', 'Mapa de calor'], ['points', 'Puntos por abonado'], ['zones', 'Zonas rojas']].map(([value, label]) => <button title={`Mostrá el mapa en modo ${label.toLowerCase()}.`} type="button" key={value} className={mode === value ? 'primary' : 'secondary'} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
          <button title={zonesMode ? 'Ajustá el mapa para mostrar todas las zonas de la fuente.' : 'Ajustá el mapa para mostrar todas las ubicaciones filtradas.'} type="button" className="secondary" disabled={!zonesMode && !located.length} onClick={() => setFitRequest(value => value + 1)}><Icon name="map" size={16} />{zonesMode ? 'Encuadrar zonas' : 'Encuadrar'}</button>
        </div>
        {zonesMode && <section className="subscriber-map-red-zones-info" aria-label="Zonas rojas">
          <div><strong>{redZonesMetadata.areaCount} áreas de referencia</strong><p>Límites y colores del mapa original. Seleccioná un área para consultar su nombre.</p><p><a href={redZonesMetadata.sourceUrl} target="_blank" rel="noopener noreferrer">Ver mapa original</a><span> · Copia del {new Date(redZonesMetadata.importedAt).toLocaleDateString('es-AR', { timeZone: 'UTC' })}. No se actualiza automáticamente.</span></p><small>Fuente: mapa comunitario de zonas de riesgo para repartidores y conductores de apps.</small></div>
        </section>}
        <Suspense fallback={<div className="subscriber-map-canvas" role="status">Cargando mapa…</div>}><MapCanvas rows={located} mode={mode} selected={selected} onSelect={selectRow} fitRequest={fitRequest} /></Suspense>
        {!zonesMode && <>{!located.length && <p className="subscriber-map-empty" role="status">{filtered.length ? 'Las cuentas de este filtro todavía no tienen coordenadas utilizables. Consultá el listado para revisar su ubicación.' : 'No hay abonados que coincidan con los filtros.'}</p>}
        <div className="subscriber-map-legend">{mode === 'heat' ? <><span>Menor concentración</span><i /><span>Mayor concentración</span><small>Densidad relativa al nivel de zoom. Cada abonado cuenta una vez.</small></> : <><span data-quality="coordinates">Coordenadas informadas</span><span data-quality="reference">Ubicación de referencia</span>{selected?.coordinates && <span data-quality="selected">Ubicación seleccionada</span>}<small>Los números agrupan abonados que comparten coordenadas.</small></>}</div>
        {filtered.some(row => row.quality === 'generic') && <p className="subscriber-map-note">Las ubicaciones genéricas agrupan cuentas en un punto común; no indican la posición exacta de cada alarma.</p>}<p className="subscriber-map-note">En el mapa de calor, la intensidad representa la concentración de abonados ubicados con los filtros actuales. Las cuentas pendientes de ubicar no forman parte del mapa.</p></>}
      </div>
      {!zonesMode && <aside className="subscriber-map-results" aria-label="Abonados del mapa">
        <h2>{filtered.length} abonados <small>· {located.length} en mapa</small></h2>
        {selected && <section className="subscriber-map-selection" aria-label="Abonado seleccionado"><button title="Cerrá la ficha de la ubicación seleccionada." className="subscriber-map-dismiss" type="button" aria-label="Cerrar selección" onClick={() => setSelectedKey(null)}><Icon name="close" size={16} /></button><b>{selected.customer.account} · {selected.customer.name}</b><p>{selected.address || 'Sin dirección informada'}</p><span>{MAP_QUALITY[selected.quality]}</span><p>{selected.reason}</p>{can('map.customer') && onOpenCustomer && <button title="Abrí la ficha completa del abonado seleccionado." type="button" className="secondary" onClick={() => onOpenCustomer(selected.customer)}><Icon name="eye" size={16} />Ver ficha del abonado</button>}</section>}
        <ul>{filtered.slice((currentPage - 1) * 20, currentPage * 20).map(row => <li key={row.key}><button title={`Seleccioná la ubicación de ${row.customer.account} ${row.customer.name}.`} type="button" aria-pressed={selectedKey === row.key} onClick={() => selectRow(row)}><strong>{row.customer.account} · {row.customer.name}</strong><span>{row.city}{row.neighborhood !== 'Sin barrio informado' ? ` · ${row.neighborhood}` : ''}</span><small>{MAP_QUALITY[row.quality]}</small></button></li>)}</ul>
        {!filtered.length && <p>No hay resultados para estos filtros.</p>}
        {pages > 1 && <nav aria-label="Páginas de abonados del mapa"><button title="Consultá la página anterior de abonados." type="button" className="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage} / {pages}</span><button title="Consultá la siguiente página de abonados." type="button" className="secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
      </aside>}
    </section>
  </div>
}
