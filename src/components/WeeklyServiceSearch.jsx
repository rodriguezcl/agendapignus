import React, { useEffect, useRef, useState } from 'react'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export default function WeeklyServiceSearch({ anchor, weekly, history }) {
  const root = useRef(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const scope = root.current?.closest('.weekly-intro')?.parentElement
    const needle = normalize(query)
    const cards = needle && scope ? [...scope.querySelectorAll('[data-weekly-search]')].filter(card => normalize(card.dataset.weeklySearch).includes(needle)) : []
    setMatches(cards)
    setIndex(0)
  }, [query, anchor, weekly, history])
  useEffect(() => {
    const card = matches[index]
    if (!card?.isConnected) return
    card.classList.add('weekly-search-current')
    card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    return () => card.classList.remove('weekly-search-current')
  }, [matches, index])
  const move = direction => setIndex(value => matches.length ? (value + direction + matches.length) % matches.length : 0)
  return <div className="weekly-service-search" ref={root} role="search" aria-label="Buscar servicios en la semana visible">
    <label>Buscar en esta semana<input type="search" value={query} placeholder="Nombre o número de cuenta" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1) } if (event.key === 'Escape') setQuery('') }} /></label>
    <span role="status" aria-live="polite">{query.trim() ? matches.length ? `${index + 1}/${matches.length}` : 'Sin resultados' : ''}</span>
    <button type="button" className="secondary" aria-label="Servicio anterior" disabled={!matches.length} onClick={() => move(-1)}>↑</button>
    <button type="button" className="secondary" aria-label="Servicio siguiente" disabled={!matches.length} onClick={() => move(1)}>↓</button>
    <button type="button" className="secondary" disabled={!matches.length} onClick={() => matches[index]?.click()}>Ver servicio</button>
  </div>
}
