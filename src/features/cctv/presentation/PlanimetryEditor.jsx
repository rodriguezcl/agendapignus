import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import schema from '../../../../shared/cctv-schema.cjs'
import { defaultDrawing, drawingLayers, drawingPoint, drawingSvg, isSegment, moveDrawingElement, removeDrawingElement, segmentBounds, segmentStyles, symbolPath } from '../domain/planimetry.mjs'
import EquipmentModelInput from './EquipmentModelInput.jsx'
import { alarmBrands, alarmGroups, dahuaGroups, hasPerimeterCatalog, perimeterCatalog } from '../domain/equipment-catalog.mjs'
import './cctv-editors.css'

const makeId = () => `plan-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
export function PlanimetryEditor({ value, onChange, readOnly = false, disabled = false, allowDownload = true }) {
  const locked = readOnly || disabled
  const descriptionId = useId()
  const parsed = useMemo(() => { try { return { drawing: schema.validateDrawing(value) } } catch (error) { return { drawing: defaultDrawing(), error: error.message } } }, [value])
  const drawing = parsed.drawing
  const [tool, setTool] = useState('select'), [selectedId, setSelectedId] = useState(''), [lineStart, setLineStart] = useState(null)
  const [preview, setPreview] = useState(null), [undoCount, setUndoCount] = useState(0), [message, setMessage] = useState('')
  const [segmentEnd, setSegmentEnd] = useState(null)
  const [zoom, setZoom] = useState(100), [snap, setSnap] = useState(false), [redoCount, setRedoCount] = useState(0)
  const undo = useRef([]), lastOutput = useRef(value), drag = useRef(null), svg = useRef(null), ignoreClick = useRef(false)
  const redo = useRef([]), viewport = useRef(null), pan = useRef(null)
  useEffect(() => { if (value !== lastOutput.current) { undo.current = []; redo.current = []; setUndoCount(0); setRedoCount(0); setSelectedId(''); setPreview(null); setLineStart(null) } lastOutput.current = value }, [value])
  const current = preview || drawing
  const selected = current.elements.find(element => element.id === selectedId)
  const originalSelected = value?.elements?.find(element => element.id === selectedId) || selected
  const perimeter = hasPerimeterCatalog(selected?.type) ? perimeterCatalog(selected.type) : null
  const modelKinds = selected?.type === 'camera' ? ['analog_camera', 'ip_camera'] : ['dvr', 'xvr', 'nvr']
  const snapPoint = point => snap ? { x: Math.round(point.x / 25) * 25, y: Math.round(point.y / 25) * 25 } : point
  function commit(next) {
    if (locked || typeof onChange !== 'function') return
    undo.current = [...undo.current.slice(-29), value || defaultDrawing()]; setUndoCount(undo.current.length)
    redo.current = []; setRedoCount(0)
    lastOutput.current = next; onChange(next); setMessage('')
  }
  function restore(from, to) {
    const next = from.current.pop()
    if (!next || locked) return
    to.current.push(value || defaultDrawing())
    lastOutput.current = next
    onChange(next)
    setUndoCount(undo.current.length); setRedoCount(redo.current.length)
    setSelectedId(''); setLineStart(null)
  }
  function changeTool(next) { ignoreClick.current = false; setTool(next); setLineStart(null); setSegmentEnd(null); setMessage('') }
  function canvasClick(event) {
    if (ignoreClick.current) { ignoreClick.current = false; return }
    if (locked || tool === 'pan' || (tool === 'select' && event.target.closest('[data-plan-element]'))) return
    const point = drawingPoint(event.clientX, event.clientY, svg.current.getBoundingClientRect())
    placeAt(point)
  }
  function placeAt(rawPoint) {
    if (locked) return
    const point = snapPoint(rawPoint)
    if (tool === 'select') { setSelectedId(''); return }
    if (tool === 'move') { if (selected) commit(moveDrawingElement(drawing, selected.id, point.x, point.y)); changeTool('select'); return }
    if (drawing.elements.length >= schema.MAX_DRAWING_ELEMENTS) { setMessage('Llegaste al máximo de 200 elementos.'); return }
    const segment = isSegment(tool)
    if (segment && !lineStart) { setLineStart(point); setMessage('Ahora elegí el segundo punto.'); return }
    const element = { id: makeId(), type: tool, ...point, label: segment && tool !== 'area' ? '' : schema.DRAWING_TYPES[tool], ...(segment ? { ...lineStart, x2: point.x, y2: point.y } : { rotation: 0 }) }
    commit({ ...drawing, elements: [...drawing.elements, element] }); setSelectedId(element.id); setLineStart(null); changeTool('select')
  }
  function beginDrag(event, element) {
    if (locked || tool !== 'select' || event.button !== 0) return
    event.stopPropagation(); setSelectedId(element.id)
    const point = drawingPoint(event.clientX, event.clientY, svg.current.getBoundingClientRect())
    drag.current = { id: element.id, start: point, element, next: null }
    svg.current.setPointerCapture?.(event.pointerId)
  }
  function moveDrag(event) {
    if (pan.current) {
      viewport.current.scrollLeft = pan.current.left + pan.current.x - event.clientX
      viewport.current.scrollTop = pan.current.top + pan.current.y - event.clientY
      return
    }
    if (lineStart && !locked) setSegmentEnd(snapPoint(drawingPoint(event.clientX, event.clientY, svg.current.getBoundingClientRect())))
    if (!drag.current || locked) return
    const point = drawingPoint(event.clientX, event.clientY, svg.current.getBoundingClientRect())
    const entry = drag.current
    if (Math.abs(point.x - entry.start.x) + Math.abs(point.y - entry.start.y) < 3 && !entry.next) return
    const destination = snapPoint({ x: entry.element.x + point.x - entry.start.x, y: entry.element.y + point.y - entry.start.y })
    entry.next = moveDrawingElement(drawing, entry.id, destination.x, destination.y)
    setPreview(entry.next)
  }
  function finishDrag(event) {
    pan.current = null
    const entry = drag.current; drag.current = null; setPreview(null)
    if (svg.current?.hasPointerCapture?.(event.pointerId)) svg.current.releasePointerCapture(event.pointerId)
    if (entry) ignoreClick.current = true
    if (entry?.next && !locked) commit(entry.next)
  }
  function updateSelected(patch) { commit({ ...(value || drawing), elements: (value?.elements || drawing.elements).map(element => element.id === selectedId ? { ...element, ...patch } : element) }) }
  function duplicateSelected() {
    const id = makeId()
    const copy = { ...selected, id }
    const next = { ...drawing, elements: [...drawing.elements, copy] }
    const dx = copy.x > 975 || copy.x2 > 975 ? -25 : 25
    const dy = copy.y > 625 || copy.y2 > 625 ? -25 : 25
    commit(moveDrawingElement(next, id, copy.x + dx, copy.y + dy))
    setSelectedId(id)
  }
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
      <button type="button" disabled={locked || !undoCount} onClick={() => restore(undo, redo)}>Deshacer</button>
      <button type="button" disabled={locked || !redoCount} onClick={() => restore(redo, undo)}>Rehacer</button>
      <button type="button" disabled={locked} aria-pressed={snap} onClick={() => setSnap(!snap)}>Ajustar a cuadrícula</button>
    </div>}
    <div className="cctv-editor-toolbar" role="group" aria-label="Zoom del plano">
      <button type="button" disabled={zoom === 100} onClick={() => setZoom(zoom - 25)} aria-label="Alejar plano">−</button>
      <button type="button" disabled={zoom === 100} onClick={() => setZoom(100)} aria-label="Restablecer zoom">{zoom}%</button>
      <button type="button" disabled={zoom === 200} onClick={() => setZoom(zoom + 25)} aria-label="Acercar plano">+</button>
      {!readOnly && <button type="button" disabled={disabled} aria-pressed={tool === 'pan'} onClick={() => changeTool(tool === 'pan' ? 'select' : 'pan')}>Desplazar vista</button>}
    </div>
    {!locked && tool !== 'select' && tool !== 'move' && tool !== 'pan' && <button className="cctv-plan-keyboard-add" type="button" onClick={() => {
      if (!isSegment(tool)) placeAt({ x: 500, y: 325 })
      else if (drawing.elements.length < schema.MAX_DRAWING_ELEMENTS) {
        const element = { id: makeId(), type: tool, x: 350, y: 325, x2: 650, y2: tool === 'area' ? 475 : 325, label: tool === 'area' ? 'Área' : '' }
        commit({ ...drawing, elements: [...drawing.elements, element] }); setSelectedId(element.id); changeTool('select')
      } else setMessage('Llegaste al máximo de 200 elementos.')
    }}>Agregar en el centro del plano</button>}
    <p id={descriptionId} className="cctv-editor-help">{readOnly ? 'Plano de referencia de la instalación.' : isSegment(tool) ? 'Marcá dos puntos en el plano para dibujar el elemento.' : tool === 'pan' ? 'Desplazá la vista del plano para recorrerlo.' : tool === 'move' ? 'Tocá el lugar donde querés mover el elemento seleccionado.' : tool === 'select' ? 'Seleccioná un elemento para editarlo. Podés arrastrarlo o usar sus coordenadas.' : `Tocá el plano para colocar: ${schema.DRAWING_TYPES[tool]}.`}</p>
    {parsed.error && <p role="alert">No se pudo leer el plano: {parsed.error}</p>}
    <div className="cctv-plan-viewport" ref={viewport}>
      <svg ref={svg} viewBox="0 0 1000 650" style={zoom > 100 ? { width: `${zoom}%`, maxWidth: 'none' } : undefined}
        className={`cctv-plan-canvas${locked ? ' is-readonly' : ''}${tool === 'pan' ? ' is-panning' : ''}`}
        role="img" aria-label="Plano de ubicación de los equipos" aria-describedby={descriptionId} onClick={canvasClick}
        onPointerDown={event => {
          if (locked || tool !== 'pan' || event.pointerType === 'touch' || event.button !== 0) return
          pan.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop }
          svg.current.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={() => { pan.current = null; drag.current = null; setPreview(null) }}>
        <rect width="1000" height="650" fill="var(--cctv-canvas, #fff)" />
        {!readOnly && <g stroke="var(--cctv-grid, #dce0e5)" strokeOpacity=".5" strokeWidth="1" pointerEvents="none">
          {Array.from({ length: 39 }, (_, i) => <line key={`x${i}`} x1={(i + 1) * 25} x2={(i + 1) * 25} y1="0" y2="650" opacity={i % 2 ? 1 : 0.45} />)}
          {Array.from({ length: 25 }, (_, i) => <line key={`y${i}`} y1={(i + 1) * 25} y2={(i + 1) * 25} x1="0" x2="1000" opacity={i % 2 ? 1 : 0.45} />)}
        </g>}
        {drawingLayers(current.elements).map(element => <g key={element.id} data-plan-element={element.id} className={selectedId === element.id && !readOnly ? 'is-selected' : ''} onPointerDown={event => beginDrag(event, element)} onClick={event => { if (tool === 'select') { event.stopPropagation(); ignoreClick.current = false; setSelectedId(element.id) } }}>
          <title>{[element.label || schema.DRAWING_TYPES[element.type], element.brand, element.model].filter(Boolean).join(' · ')}</title>
          {isSegment(element.type) ? <DrawingSegment element={element} /> : <>
            <circle className="cctv-plan-hit" cx={element.x} cy={element.y} r="27" />
            {element.type !== 'text' && <path className="cctv-plan-symbol" d={symbolPath(element.type)} transform={`translate(${element.x} ${element.y}) rotate(${element.rotation || 0})`} />}
            <text x={element.x} y={element.y + (element.type === 'text' ? 0 : 33)} textAnchor="middle">{element.label}</text>
            {element.model && <text x={element.x} y={element.y + 49} textAnchor="middle" className="cctv-plan-model">{[element.brand, element.model].filter(Boolean).join(' ')}</text>}
          </>}
        </g>)}
        {lineStart && <g pointerEvents="none">
          {segmentEnd && <g opacity=".65"><DrawingSegment element={{ type: tool, ...lineStart, x2: segmentEnd.x, y2: segmentEnd.y }} /></g>}
          <circle cx={lineStart.x} cy={lineStart.y} r="7" fill="var(--ap-accent, #956600)" />
        </g>}
      </svg>
    </div>
    {!readOnly && <div className="cctv-plan-properties">
      <label>Elemento seleccionado<select aria-label="Elemento seleccionado" disabled={disabled || !drawing.elements.length} value={selectedId} onChange={event => { setSelectedId(event.target.value); changeTool('select') }}><option value="">Seleccionar elemento</option>{drawing.elements.map((element, index) => <option key={element.id} value={element.id}>{index + 1}. {element.label || schema.DRAWING_TYPES[element.type]}</option>)}</select></label>
      {selected && <>
        <label>Etiqueta / nota<input disabled={disabled} maxLength={selected.type === 'text' ? 1000 : 160} value={originalSelected?.label || ''} onChange={event => updateSelected({ label: event.target.value })} /></label>
        {['camera', 'recorder'].includes(selected.type) && <EquipmentModelInput key={selected.type} disabled={disabled} groups={dahuaGroups(modelKinds)} kindLabels={schema.EQUIPMENT_KINDS.cctv} label="Modelo Dahua" value={originalSelected?.model} onChange={model => updateSelected({ model })} />}
        {selected.type === 'alarm' && <>
          <label>Marca de la alarma<select disabled={disabled} value={selected.brand || ''} onChange={event => updateSelected({ brand: event.target.value, model: '' })}>
            <option value="">Sin especificar</option>
            {alarmBrands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
          </select></label>
          {selected.brand && <EquipmentModelInput key={selected.brand} disabled={disabled} groups={alarmGroups(selected.brand)} kindLabels={schema.EQUIPMENT_KINDS.alarm} label={`Modelo ${selected.brand}`} value={originalSelected?.model} onChange={model => updateSelected({ model })} />}
        </>}
        {perimeter && <EquipmentModelInput key={selected.type} disabled={disabled} groups={perimeter.groups} products={perimeter.products}
          kindLabels={schema.EQUIPMENT_KINDS[selected.type]} label="Modelo / SKU de IR Seguridad" value={originalSelected?.model}
          onChange={model => updateSelected({ model, brand: perimeter.products[model]?.brand || '' })} />}
        <div className="cctv-editor-grid">
          {['x', 'y', ...(isSegment(selected.type) ? ['x2', 'y2'] : [])].map(coordinate => <label key={coordinate}>{({ x: 'Posición X', y: 'Posición Y', x2: 'Final X', y2: 'Final Y' })[coordinate]}<input type="number" min="0" max={coordinate.startsWith('x') ? 1000 : 650} disabled={disabled} value={selected[coordinate]} onChange={event => { if (event.target.value !== '' && event.target.validity.valid) updateSelected({ [coordinate]: Number(event.target.value) }) }} /></label>)}
          {!isSegment(selected.type) && <label>Orientación (°)<input type="number" min="0" max="360" disabled={disabled} value={selected.rotation || 0} onChange={event => { if (event.target.value !== '' && event.target.validity.valid) updateSelected({ rotation: Number(event.target.value) }) }} /></label>}
        </div>
        <div className="cctv-editor-toolbar"><button type="button" disabled={disabled} onClick={() => changeTool('move')}>Mover con un toque</button><button type="button" disabled={disabled || drawing.elements.length >= schema.MAX_DRAWING_ELEMENTS} onClick={duplicateSelected}>Duplicar elemento</button><button type="button" disabled={disabled} onClick={() => { commit(removeDrawingElement(drawing, selectedId)); setSelectedId('') }}>Quitar elemento</button></div>
      </>}
    </div>}
    <div className="cctv-editor-footer"><span>{drawing.elements.length} / {schema.MAX_DRAWING_ELEMENTS} elementos · Plano orientativo, sin escala.</span>{allowDownload && <button type="button" disabled={disabled || Boolean(parsed.error) || !drawing.elements.length} onClick={exportSvg}>Descargar plano SVG</button>}</div>
    <p className="cctv-editor-help" role="status" aria-live="polite">{message}</p>
  </section>
}
function DrawingSegment({ element }) {
  const bounds = segmentBounds(element)
  const geometry = { x1: element.x, y1: element.y, x2: element.x2, y2: element.y2 }
  return <>
    {element.type === 'area' ? <rect className="cctv-plan-geometry" {...bounds} {...segmentStyles.area} /> : <>
      <line className="cctv-plan-hit" {...geometry} />
      <line className="cctv-plan-geometry" {...geometry} {...segmentStyles[element.type]} />
    </>}
    <text x={bounds.x + bounds.width / 2} y={bounds.y + bounds.height / 2 - 8} textAnchor="middle">{element.label}</text>
  </>
}
export default PlanimetryEditor
