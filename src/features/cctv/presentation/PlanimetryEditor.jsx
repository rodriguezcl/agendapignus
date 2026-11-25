import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import schema from '../../../../shared/cctv-schema.cjs'
import { defaultDrawing, drawingPoint, drawingSvg, moveDrawingElement, removeDrawingElement, symbolPath } from '../domain/planimetry.mjs'
import './cctv-editors.css'

const makeId = () => `plan-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
export function PlanimetryEditor({ value, onChange, readOnly = false, disabled = false, allowDownload = true }) {
  const locked = readOnly || disabled
  const descriptionId = useId()
  const parsed = useMemo(() => { try { return { drawing: schema.validateDrawing(value) } } catch (error) { return { drawing: defaultDrawing(), error: error.message } } }, [value])
  const drawing = parsed.drawing
  const [tool, setTool] = useState('select'), [selectedId, setSelectedId] = useState(''), [lineStart, setLineStart] = useState(null)
  const [preview, setPreview] = useState(null), [undoCount, setUndoCount] = useState(0), [message, setMessage] = useState('')
  const undo = useRef([]), lastOutput = useRef(value), drag = useRef(null), svg = useRef(null), ignoreClick = useRef(false)
  useEffect(() => { if (value !== lastOutput.current) { undo.current = []; setUndoCount(0); setSelectedId(''); setPreview(null); setLineStart(null) } lastOutput.current = value }, [value])
  const current = preview || drawing
  const selected = current.elements.find(element => element.id === selectedId)
  const originalSelected = value?.elements?.find(element => element.id === selectedId) || selected
  function commit(next) {
    if (locked || typeof onChange !== 'function') return
    undo.current = [...undo.current.slice(-29), value || defaultDrawing()]; setUndoCount(undo.current.length)
    lastOutput.current = next; onChange(next); setMessage('')
  }
  function changeTool(next) { setTool(next); setLineStart(null); setMessage('') }
  function canvasClick(event) {
    if (ignoreClick.current) { ignoreClick.current = false; return }
    if (locked || event.target.closest('[data-plan-element]')) return
    const point = drawingPoint(event.clientX, event.clientY, svg.current.getBoundingClientRect())
    placeAt(point)
  }
  function placeAt(point) {
    if (locked) return
    if (tool === 'select') { setSelectedId(''); return }
    if (tool === 'move') { if (selected) commit(moveDrawingElement(drawing, selected.id, point.x, point.y)); changeTool('select'); return }
    if (drawing.elements.length >= schema.MAX_DRAWING_ELEMENTS) { setMessage('Llegaste al máximo de 200 elementos.'); return }
    if (tool === 'line' && !lineStart) { setLineStart(point); setMessage('Ahora elegí el punto final de la línea.'); return }
    const element = { id: makeId(), type: tool, ...point, label: tool === 'line' ? '' : schema.DRAWING_TYPES[tool], ...(tool === 'line' ? { ...lineStart, x2: point.x, y2: point.y } : { rotation: 0 }) }
    commit({ ...drawing, elements: [...drawing.elements, element] }); setSelectedId(element.id); setLineStart(null); changeTool('select')
  }
  function beginDrag(event, element) {
    event.stopPropagation(); setSelectedId(element.id)
    if (locked || tool !== 'select') return
    const point = drawingPoint(event.clientX, event.clientY, svg.current.getBoundingClientRect())
    drag.current = { id: element.id, start: point, element, next: null }
    svg.current.setPointerCapture?.(event.pointerId)
  }
  function moveDrag(event) {
    if (!drag.current || locked) return
    const point = drawingPoint(event.clientX, event.clientY, svg.current.getBoundingClientRect())
    const entry = drag.current
    if (Math.abs(point.x - entry.start.x) + Math.abs(point.y - entry.start.y) < 3 && !entry.next) return
    entry.next = moveDrawingElement(drawing, entry.id, entry.element.x + point.x - entry.start.x, entry.element.y + point.y - entry.start.y)
    setPreview(entry.next)
  }
  function finishDrag(event) {
    const entry = drag.current; drag.current = null; setPreview(null)
    if (svg.current?.hasPointerCapture?.(event.pointerId)) svg.current.releasePointerCapture(event.pointerId)
    if (entry) ignoreClick.current = true
    if (entry?.next && !locked) commit(entry.next)
  }
  function updateSelected(patch) { commit({ ...(value || drawing), elements: (value?.elements || drawing.elements).map(element => element.id === selectedId ? { ...element, ...patch } : element) }) }
  function exportSvg() {
    if (!allowDownload || disabled) return
    try {
      const url = URL.createObjectURL(new Blob([drawingSvg(value)], { type: 'image/svg+xml;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = 'planimetria-cctv.svg'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setMessage(error.message) }
  }
  return <section className="cctv-plan-editor" aria-label="Editor de planimetría">
    {!readOnly && <div className="cctv-editor-toolbar" role="group" aria-label="Herramientas del plano">
      <button type="button" disabled={disabled} aria-pressed={tool === 'select'} onClick={() => changeTool('select')}>Seleccionar / mover</button>
      {Object.entries(schema.DRAWING_TYPES).map(([type, label]) => <button key={type} type="button" disabled={disabled} aria-pressed={tool === type} onClick={() => changeTool(type)}>+ {label}</button>)}
      <button type="button" disabled={locked || !undoCount} onClick={() => { const next = undo.current.pop(); if (next) { lastOutput.current = next; onChange(next); setUndoCount(undo.current.length); setSelectedId(''); setLineStart(null) } }}>Deshacer</button>
    </div>}
    {!locked && tool !== 'select' && tool !== 'move' && <button className="cctv-plan-keyboard-add" type="button" onClick={() => {
      if (tool !== 'line') placeAt({ x: 500, y: 325 })
      else if (drawing.elements.length < schema.MAX_DRAWING_ELEMENTS) {
        const element = { id: makeId(), type: 'line', x: 350, y: 325, x2: 650, y2: 325, label: '' }
        commit({ ...drawing, elements: [...drawing.elements, element] }); setSelectedId(element.id); changeTool('select')
      } else setMessage('Llegaste al máximo de 200 elementos.')
    }}>Agregar en el centro del plano</button>}
    <p id={descriptionId} className="cctv-editor-help">{readOnly ? 'Plano de referencia de la instalación.' : tool === 'line' ? 'Tocá el inicio y el final para trazar una línea de perímetro o cableado.' : tool === 'move' ? 'Tocá el lugar donde querés mover el elemento seleccionado.' : tool === 'select' ? 'Seleccioná un elemento para editarlo. Podés arrastrarlo o usar sus coordenadas.' : `Tocá el plano para colocar: ${schema.DRAWING_TYPES[tool]}.`}</p>
    {parsed.error && <p role="alert">No se pudo leer el plano: {parsed.error}</p>}
    <div className="cctv-plan-viewport">
      <svg ref={svg} viewBox="0 0 1000 650" className={`cctv-plan-canvas${locked ? ' is-readonly' : ''}`} role="img" aria-label="Plano de ubicación de los equipos" aria-describedby={descriptionId} onClick={canvasClick} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={() => { drag.current = null; setPreview(null) }}>
        <rect width="1000" height="650" fill="var(--cctv-canvas, #fff)" />
        {!readOnly && <g stroke="var(--cctv-grid, #dce0e5)" strokeOpacity=".5" strokeWidth="1" pointerEvents="none">{Array.from({ length: 19 }, (_, i) => <line key={`x${i}`} x1={(i + 1) * 50} x2={(i + 1) * 50} y1="0" y2="650" />)}{Array.from({ length: 12 }, (_, i) => <line key={`y${i}`} y1={(i + 1) * 50} y2={(i + 1) * 50} x1="0" x2="1000" />)}</g>}
        {current.elements.map(element => <g key={element.id} data-plan-element={element.id} className={selectedId === element.id && !readOnly ? 'is-selected' : ''} onPointerDown={event => beginDrag(event, element)} onClick={event => { event.stopPropagation(); ignoreClick.current = false; setSelectedId(element.id) }}>
          <title>{element.label || schema.DRAWING_TYPES[element.type]}</title>
          {element.type === 'line' ? <><line className="cctv-plan-hit" x1={element.x} y1={element.y} x2={element.x2} y2={element.y2} /><line className="cctv-plan-line" x1={element.x} y1={element.y} x2={element.x2} y2={element.y2} /><text x={(element.x + element.x2) / 2} y={(element.y + element.y2) / 2 - 8}>{element.label}</text></> : <>
            <circle className="cctv-plan-hit" cx={element.x} cy={element.y} r="27" />
            {element.type !== 'text' && <path className="cctv-plan-symbol" d={symbolPath(element.type)} transform={`translate(${element.x} ${element.y}) rotate(${element.rotation || 0})`} />}
            <text x={element.x} y={element.y + (element.type === 'text' ? 0 : 33)} textAnchor="middle">{element.label}</text>
          </>}
        </g>)}
        {lineStart && <circle cx={lineStart.x} cy={lineStart.y} r="7" fill="var(--ap-accent, #956600)" />}
      </svg>
    </div>
    {!readOnly && <div className="cctv-plan-properties">
      <label>Elemento seleccionado<select aria-label="Elemento seleccionado" disabled={disabled || !drawing.elements.length} value={selectedId} onChange={event => { setSelectedId(event.target.value); changeTool('select') }}><option value="">Seleccionar elemento</option>{drawing.elements.map((element, index) => <option key={element.id} value={element.id}>{index + 1}. {element.label || schema.DRAWING_TYPES[element.type]}</option>)}</select></label>
      {selected && <>
        <label>Etiqueta / nota<input disabled={disabled} maxLength={selected.type === 'text' ? 1000 : 160} value={originalSelected?.label || ''} onChange={event => updateSelected({ label: event.target.value })} /></label>
        <div className="cctv-editor-grid">
          {['x', 'y', ...(selected.type === 'line' ? ['x2', 'y2'] : [])].map(coordinate => <label key={coordinate}>{({ x: 'Posición X', y: 'Posición Y', x2: 'Final X', y2: 'Final Y' })[coordinate]}<input type="number" min="0" max={coordinate.startsWith('x') ? 1000 : 650} disabled={disabled} value={selected[coordinate]} onChange={event => { if (event.target.value !== '' && event.target.validity.valid) updateSelected({ [coordinate]: Number(event.target.value) }) }} /></label>)}
          {selected.type !== 'line' && <label>Orientación (°)<input type="number" min="0" max="360" disabled={disabled} value={selected.rotation || 0} onChange={event => { if (event.target.value !== '' && event.target.validity.valid) updateSelected({ rotation: Number(event.target.value) }) }} /></label>}
        </div>
        <div className="cctv-editor-toolbar"><button type="button" disabled={disabled} onClick={() => changeTool('move')}>Mover con un toque</button><button type="button" disabled={disabled} onClick={() => { commit(removeDrawingElement(drawing, selectedId)); setSelectedId('') }}>Quitar elemento</button></div>
      </>}
    </div>}
    <div className="cctv-editor-footer"><span>{drawing.elements.length} / {schema.MAX_DRAWING_ELEMENTS} elementos · Plano orientativo, sin escala.</span>{allowDownload && <button type="button" disabled={disabled || Boolean(parsed.error) || !drawing.elements.length} onClick={exportSvg}>Descargar plano SVG</button>}</div>
    <p className="cctv-editor-help" role="status" aria-live="polite">{message}</p>
  </section>
}
export default PlanimetryEditor
