import React, { useEffect, useMemo, useRef, useState } from 'react'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export default function WeeklyServiceSearch({ anchor, weekly, history, getPlan, navigate, boardRef, topScrollRef, openService }) {
  const root = useRef(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const matches = useMemo(() => {
    const needle = normalize(query)
    if (!needle) return []
    const dates = [...new Set([...Object.keys(weekly || {}), ...(history || []).map(record => record.date)])].filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort()
    return dates.flatMap(day => (getPlan(day).teams || []).flatMap((team, teamIndex) => (team.tasks || []).flatMap((task, taskIndex) =>
      task.client && normalize([task.client, task.clientAccount, task.clientNameAtService].join(' ')).includes(needle)
        ? [{ day, teamIndex, taskIndex, key: `${day}/${teamIndex}/${taskIndex}` }] : [])))
  }, [query, weekly, history])
  const selectedIndex = Math.min(index, Math.max(0, matches.length - 1))
  const selected = matches[selectedIndex]
  useEffect(() => {
    setReady(false)
    if (!selected) return
    navigate(selected.day)
    const board = boardRef.current
    if (!board) return
    let highlighted = null
    let frame
    const reveal = () => {
      const card = [...board.querySelectorAll('[data-weekly-search-key]')].find(node => node.dataset.weeklySearchKey === selected.key)
      if (!card) return
      highlighted = card
      card.classList.add('weekly-search-current')
      card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      const rect = card.getBoundingClientRect(), viewport = board.getBoundingClientRect()
      board.scrollLeft += rect.left - viewport.left - (board.clientWidth - rect.width) / 2
      const top = topScrollRef.current
      if (top) top.scrollLeft = board.scrollLeft / Math.max(1, board.scrollWidth - board.clientWidth) * Math.max(0, top.scrollWidth - top.clientWidth)
      setReady(true)
      observer.disconnect()
    }
    // Wait for the target week and its holiday/calendar loading to render.
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal) })
    observer.observe(board, { childList: true, subtree: true })
    frame = requestAnimationFrame(reveal)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); highlighted?.classList.remove('weekly-search-current') }
  }, [selected?.key, anchor, weekly, history])
  const move = direction => setIndex(matches.length ? (selectedIndex + direction + matches.length) % matches.length : 0)
  return <div className="weekly-service-search" ref={root} role="search" aria-label="Buscar servicios entre semanas">
    <label>Buscar en todas las semanas<input type="search" value={query} placeholder="Nombre o número de cuenta" onChange={event => { setQuery(event.target.value); setIndex(0) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1) } if (event.key === 'Escape') setQuery('') }} /></label>
    <span role="status" aria-live="polite">{query.trim() ? matches.length ? `${selectedIndex + 1}/${matches.length} · ${selected.day.split('-').reverse().join('/')}` : 'Sin resultados' : ''}</span>
    <button type="button" className="secondary" aria-label="Servicio anterior" disabled={!matches.length} onClick={() => move(-1)}>↑</button>
    <button type="button" className="secondary" aria-label="Servicio siguiente" disabled={!matches.length} onClick={() => move(1)}>↓</button>
    <button type="button" className="secondary" disabled={!selected || !ready} onClick={() => openService(selected.day, selected.teamIndex, selected.taskIndex)}>Ver servicio</button>
  </div>
}
