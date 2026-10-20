// Source geometries are independent of subscriber data and reusable between views.
export function createRedZonesLayer(L, data) {
  return L.geoJSON(data, {
    pane: 'redZones',
    style: feature => ({
      color: feature.properties.sourceColor,
      fillColor: feature.properties.sourceColor,
      weight: 2, opacity: 0.9, fillOpacity: 0.14, dashArray: '6 4',
      className: 'subscriber-map-red-zone'
    }),
    onEachFeature: (feature, layer) => {
      const { name, sourceLayer } = feature.properties
      const popup = document.createElement('div')
      popup.className = 'subscriber-map-zone-popup'
      const title = document.createElement('b')
      title.textContent = name
      const origin = document.createElement('p')
      origin.textContent = `Área de la fuente · ${sourceLayer}`
      popup.append(title, origin)
      layer.bindPopup(popup, { maxWidth: 300 })
      let element
      const openWithKeyboard = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        L.DomEvent.stop(event)
        layer.openPopup()
      }
      layer.on('add', () => {
        element = layer.getElement()
        element.setAttribute('tabindex', '0')
        element.setAttribute('role', 'button')
        element.setAttribute('aria-label', `Zona del mapa de referencia: ${name}`)
        L.DomEvent.on(element, 'keydown', openWithKeyboard)
      })
      layer.on('remove', () => {
        if (element) L.DomEvent.off(element, 'keydown', openWithKeyboard)
        element = null
      })
    }
  })
}
