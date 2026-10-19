import React, { useId } from 'react'
import { doctaLocation } from '../domain/customers/customer-location.mjs'
import { nobuTownLocation } from '../domain/customers/nobu-town-location.mjs'
import { customerCoordinates, coordinateDraftError, validCoordinates } from '../domain/customers/customer-coordinates.mjs'
import './customer-coordinates-field.css'

export default function CustomerCoordinatesField({ form, setForm }) {
  const id = useId()
  const nobu = nobuTownLocation(form)
  if (nobu) return <section className="customer-coordinates"><strong>Ubicación en el mapa</strong><p>{nobu.label}.</p><small>Todas las cuentas del barrio comparten esta referencia.</small></section>
  const docta = doctaLocation(form)
  if (docta) return <section className="customer-coordinates"><strong>Ubicación en el mapa</strong><p>{docta.label}. La referencia de Docta se calcula a partir de la dirección y la manzana.</p></section>
  const coordinates = customerCoordinates(form)
  const draft = form.coordinateDraft || { latitude: coordinates?.[0] ?? '', longitude: coordinates?.[1] ?? '' }
  const error = coordinateDraftError(form.coordinateDraft)
  const manual = Boolean(form.coordinateDraft || validCoordinates(form.locationOverride))
  const change = key => event => setForm({ ...form, coordinateDraft: { ...draft, [key]: event.target.value } })
  const restore = () => {
    const { coordinateDraft, locationOverride, ...rest } = form
    setForm(rest)
  }
  return <section className="customer-coordinates" aria-labelledby={`${id}-title`}>
    <strong id={`${id}-title`}>Ubicación en el mapa</strong>
    <p id={`${id}-help`}>Corregí latitud y longitud con punto o coma decimal. La corrección se conserva al importar el padrón nuevamente.</p>
    <div className="customer-coordinates-inputs">
      <label>Latitud<input type="text" inputMode="decimal" autoComplete="off" value={draft.latitude} onChange={change('latitude')} placeholder="Ej.: -31.4167" aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={Boolean(error)} /></label>
      <label>Longitud<input type="text" inputMode="decimal" autoComplete="off" value={draft.longitude} onChange={change('longitude')} placeholder="Ej.: -64.1833" aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={Boolean(error)} /></label>
    </div>
    {error && <p className="customer-coordinates-error" id={`${id}-error`} role="alert">{error}</p>}
    <div className="customer-coordinates-footer"><small>{manual ? 'Corrección manual' : coordinates ? 'Coordenadas importadas' : 'Sin coordenadas registradas'}</small>
      {manual && <button type="button" className="secondary" onClick={restore}>Restablecer ubicación importada</button>}
    </div>
  </section>
}
