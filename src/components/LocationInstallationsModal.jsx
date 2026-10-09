import React, { useEffect, useRef } from 'react'
import './location-installations-modal.css'

export default function LocationInstallationsModal({ records, category, label, month, zoneOf, close }) {
  const modal = useRef(null)
  const closeButton = useRef(null)
  const showSubscription = !['docta', 'nobu-town'].includes(category)
  const rows = records.filter(record => category === 'all' || zoneOf(record) === category)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.client || '').localeCompare(String(b.client || ''), 'es'))
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus()
    return () => previous?.focus?.()
  }, [])
  const money = value => {
    const raw = String(value ?? '').trim().replace(/^\$\s*/, '')
    if (!raw) return 'Sin registrar'
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw
    const amount = Number(normalized)
    return Number.isFinite(amount) ? `$ ${amount.toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}` : 'Sin registrar'
  }
  return <div className="modal-layer" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={modal} className="modal location-installations-modal" role="dialog" aria-modal="true" aria-labelledby="location-installations-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const controls = [...modal.current.querySelectorAll('button, [tabindex="0"]')]
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <button title="Cerrá el detalle de instalaciones de esta ubicación." ref={closeButton} type="button" className="close-modal" aria-label="Cerrar detalle por ubicación" onClick={close}>×</button>
      <p className="eyebrow">ALTAS DE SERVICIO · DETALLE POR UBICACIÓN</p>
      <h2 id="location-installations-title">{label}</h2>
      <p>{new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })} · {rows.length} instalación(es) completada(s)</p>
      {rows.length ? <div className="location-installations-table" tabIndex={0} role="region" aria-label="Listado de instalaciones">
        <table><thead><tr>{['Fecha', 'Cliente', 'Dirección', 'Contacto', 'Técnicos asignados', ...(showSubscription ? ['Abono mensual', 'Meses congelados', 'Cantidad de meses'] : [])].map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead>
          <tbody>{rows.map(record => { const applies = !['docta', 'nobu-town'].includes(zoneOf(record)); return <tr key={record.id}>
            <td>{record.date?.split('-').reverse().join('/')}</td><td>{record.client || 'Sin cliente'}</td><td>{record.address || '—'}</td><td>{record.phone || '—'}</td><td>{record.technicians?.join(' / ') || '—'}</td>
            {showSubscription && <><td>{applies ? money(record.monthlyFee) : 'No aplica'}</td><td>{!applies ? 'No aplica' : record.freezeMonthlyFee === true ? 'Sí' : record.freezeMonthlyFee === false ? 'No' : 'Sin registrar'}</td><td>{!applies ? 'No aplica' : record.freezeMonthlyFee ? record.frozenMonths || 'Sin registrar' : '—'}</td></>}
          </tr> })}</tbody></table>
      </div> : <p className="empty-state">No hay instalaciones completadas para esta ubicación en el mes seleccionado.</p>}
      <div className="modal-actions"><button title="Cerrá el detalle y volvé al resumen de instalaciones." type="button" className="secondary" onClick={close}>Cerrar</button></div>
    </section>
  </div>
}
