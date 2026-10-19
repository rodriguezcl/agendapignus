import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { groupMapLocations, MAP_QUALITY } from '../domain/customers/subscriber-map.mjs'

export default function SubscriberMapCanvas({ rows, mode, selected, onSelect, fitRequest }) {
  const element = useRef(null), instance = useRef(null), layers = useRef(null), onSelectRef = useRef(onSelect)
  const markers = useRef(new Map()), highlightedMarker = useRef(null)
  const [ready, setReady] = useState(false), [error, setError] = useState('')
  onSelectRef.current = onSelect
  useEffect(() => {
    let disposed = false
    // Leaflet.heat extends Leaflet's global singleton.
    window.L = L
    import('leaflet.heat').then(() => {
      if (disposed) return
      const map = L.map(element.current, { center: [-31.4167, -64.1833], zoom: 11, minZoom: 3, maxZoom: 18, scrollWheelZoom: true, zoomAnimation: false })
      instance.current = map
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        referrerPolicy: 'strict-origin-when-cross-origin'
      }).addTo(map)
      tiles.on('tileerror', () => setError('No se pudo cargar una parte del mapa. Podés seguir consultando el listado o reintentar.'))
      instance.current.baseTiles = tiles
      L.control.scale({ imperial: false }).addTo(map)
      layers.current = L.layerGroup().addTo(map)
      setReady(true)
    }).catch(() => { if (!disposed) setError('No se pudo iniciar el mapa. Recargá la página para reintentar; el listado sigue disponible.') })
    return () => { disposed = true; instance.current?.remove(); instance.current = null }
  }, [])
  useEffect(() => {
    if (!ready) return
    const observer = new ResizeObserver(() => instance.current?.invalidateSize({ pan: false }))
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [ready])
  useEffect(() => {
    if (!ready) return
    const group = layers.current
    group.clearLayers()
    markers.current.clear()
    if (mode === 'heat') {
      L.heatLayer(rows.map(row => [...row.coordinates, 1]), { radius: 25, blur: 20, maxZoom: 12, max: 5, minOpacity: 0.25, gradient: { 0.2: '#418bcc', 0.45: '#77c8cb', 0.65: '#f3cf58', 0.85: '#ef8536', 1: '#c62e39' } }).addTo(group)
    } else {
      for (const item of groupMapLocations(rows)) {
        const approximate = item.rows.some(row => row.quality !== 'coordinates')
        const marker = L.marker(item.coordinates, { icon: L.divIcon({ className: `subscriber-map-pin ${approximate ? 'is-approximate' : ''}`, html: `<span>${item.rows.length > 1 ? item.rows.length : '•'}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] }), title: item.rows.length === 1 ? `${item.rows[0].customer.account} · ${item.rows[0].customer.name}` : `${item.rows.length} abonados en esta referencia`, keyboard: true })
        const popup = document.createElement('div'); popup.className = 'subscriber-map-popup'
        const heading = document.createElement('b'); heading.textContent = item.rows.length > 1 ? `${item.rows.length} abonados en esta referencia` : 'Abonado'; popup.append(heading)
        for (const row of item.rows) {
          const button = document.createElement('button'); button.type = 'button'
          button.textContent = `${row.customer.account} · ${row.customer.name}`
          button.addEventListener('click', () => { onSelectRef.current(row); marker.closePopup() }); popup.append(button)
          const quality = document.createElement('small'); quality.textContent = MAP_QUALITY[row.quality]; popup.append(quality)
        }
        marker.bindPopup(popup, { maxWidth: 300 }).addTo(group)
        item.rows.forEach(row => markers.current.set(row.key, marker))
      }
    }
  }, [rows, mode, ready])
  useEffect(() => {
    const previous = highlightedMarker.current
    if (previous?.getElement()) {
      previous.getElement().classList.remove('is-selected')
      previous.getElement().setAttribute('aria-pressed', 'false')
      previous.setZIndexOffset(0)
    }
    const marker = mode === 'points' ? markers.current.get(selected?.key) : null
    if (marker?.getElement()) {
      marker.getElement().classList.add('is-selected')
      marker.getElement().setAttribute('aria-pressed', 'true')
      marker.setZIndexOffset(10000)
    }
    highlightedMarker.current = marker
  }, [selected?.key, rows, mode, ready])
  useEffect(() => {
    if (!ready) return
    if (rows.length) instance.current.fitBounds(rows.map(row => row.coordinates), { padding: [32, 32], maxZoom: 14, animate: false })
  }, [rows, fitRequest, ready])
  useEffect(() => {
    if (ready && selected?.coordinates) instance.current.setView(selected.coordinates, 16, { animate: false })
  }, [selected, ready])
  return <div className="subscriber-map-canvas-wrap">
    <div ref={element} className="subscriber-map-canvas" aria-label="Mapa de distribución de abonados. Usá la rueda del mouse, las flechas y los controles de zoom para explorar." />
    {error && <div role="alert" className="subscriber-map-load-error">{error}{ready && <button type="button" onClick={() => { setError(''); instance.current.baseTiles.redraw() }}>Reintentar mapa</button>}</div>}
    {!ready && !error && <div className="subscriber-map-loading" role="status">Cargando mapa…</div>}
  </div>
}
