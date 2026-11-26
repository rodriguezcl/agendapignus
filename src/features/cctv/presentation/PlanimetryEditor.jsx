import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import schema from '../../../../shared/cctv-schema.cjs'
import { defaultDrawing, drawingLayers, drawingPoint, drawingSvg, isSegment, moveDrawingElement, removeDrawingElement, segmentBounds, segmentStyles, symbolPath } from '../domain/planimetry.mjs'
import EquipmentModelInput from './EquipmentModelInput.jsx'
import ProductPhotos from './ProductPhotos.jsx'
import { equipmentCatalogFor, isPerimeter } from '../domain/equipment-catalog.mjs'
import { useProductCatalog } from '../../products/application/useProductCatalog.mjs'
import './cctv-editors.css'

const makeId = () => `plan-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
const equipmentName = item => item.label || schema.EQUIPMENT_KINDS[item.category]?.[item.kind] || 'Equipo'
function placementHelp(tool, item) {
  if (tool === 'inventory') return item ? `Tocá el plano donde querés ubicar «${equipmentName(item)}».` : 'Elegí un equipo de la ficha técnica.'
  if (isSegment(tool)) return 'Marcá dos puntos en el plano para dibujar el elemento.'
  if (tool === 'pan') return 'Desplazá la vista del plano para recorrerlo.'
  if (tool === 'move') return 'Tocá el lugar donde querés mover el elemento seleccionado.'
  if (tool === 'select') return 'Seleccioná un elemento para editarlo. Podés arrastrarlo o usar sus coordenadas.'
  return `Tocá el plano para colocar: ${schema.DRAWING_TYPES[tool]}.`
}
export function PlanimetryEditor({ value, equipment = [], onChange, readOnly = false, disabled = false, allowDownload = true }) {
  const locked = readOnly || disabled
  const descriptionId = useId()
  const { products, loading, error } = useProductCatalog()
  const catalog = equipmentCatalogFor(products)
  const parsed = useMemo(() => { try { return { drawing: schema.validateDrawing(value) } } catch (error) { return { drawing: defaultDrawing(), error: error.message } } }, [value])
  const drawing = parsed.drawing
  const [tool, setTool] = useState('select'), [selectedId, setSelectedId] = useState(''), [lineStart, setLineStart] = useState(null)
  const [placementId, setPlacementId] = useState('')
  const [preview, setPreview] = useState(null), [undoCount, setUndoCount] = useState(0), [message, setMessage] = useState('')
  const [segmentEnd, setSegmentEnd] = useState(null)
  const [zoom, setZoom] = useState(100), [snap, setSnap] = useState(false), [redoCount, setRedoCount] = useState(0)
  const undo = useRef([]), lastOutput = useRef(value), drag = useRef(null), svg = useRef(null), ignoreClick = useRef(false)
  const redo = useRef([]), viewport = useRef(null), pan = useRef(null)
  useEffect(() => { if (value !== lastOutput.current) { undo.current = []; redo.current = []; setUndoCount(0); setRedoCount(0); setSelectedId(''); setPreview(null); setLineStart(null); changeTool('select') } lastOutput.current = value }, [value])
  const current = preview || drawing
  const selected = current.elements.find(element => element.id === selectedId)
  const originalSelected = value?.elements?.find(element => element.id === selectedId) || selected
  const unitsOnPlan = useMemo(() => {
    const counts = new Map()
    for (const { equipmentId } of drawing.elements) {
      if (equipmentId) counts.set(equipmentId, (counts.get(equipmentId) || 0) + 1)
    }
    return counts
  }, [drawing])
  const availableUnits = item => item ? Math.max(0, (item.quantity ?? 1) - (unitsOnPlan.get(item.id) || 0)) : 0
  const placementItem = equipment.find(item => item.id === placementId)
  const linkedItem = selected?.equipmentId && equipment.find(item => item.id === selected.equipmentId)
  const canDuplicate = selected && drawing.elements.length < schema.MAX_DRAWING_ELEMENTS && (!selected.equipmentId || availableUnits(linkedItem) > 0)
  const modelKinds = schema.CCTV_SYMBOL_KINDS[selected?.type]
  const category = modelKinds ? 'cctv' : selected?.type
  const perimeter = isPerimeter(category)
  // Camera and recorder symbols from earlier plans saved only the Dahua model.
  const legacyDahua = modelKinds && !selected.brand && selected.model && catalog.find({ category, brand: 'Dahua', model: selected.model })
  const brand = selected?.brand || (legacyDahua ? 'Dahua' : '')
  const brands = category && !perimeter && !selected?.equipmentId ? catalog.brands(category, modelKinds) : []
  const options = category && !selected?.equipmentId ? catalog.choices(category, modelKinds, perimeter ? '' : brand) : []
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
    setSelectedId(''); changeTool('select')
  }
  function changeTool(next, itemId = '') { ignoreClick.current = false; setTool(next); setPlacementId(itemId); setLineStart(null); setSegmentEnd(null); setMessage('') }
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
    let element
    if (tool === 'inventory') {
      if (!availableUnits(placementItem)) { setMessage('Este equipo ya no tiene unidades disponibles en el plano.'); return }
      element = { id: makeId(), ...schema.equipmentSymbolFields(placementItem), ...point, label: equipmentName(placementItem), rotation: 0 }
    } else {
      element = { id: makeId(), type: tool, ...point, label: segment && tool !== 'area' ? '' : schema.DRAWING_TYPES[tool], ...(segment ? { ...lineStart, x2: point.x, y2: point.y } : { rotation: 0 }) }
    }
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
    if (locked || !canDuplicate) return
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
    {!readOnly && <label className="cctv-plan-inventory">Equipo de la ficha técnica
      <select aria-label="Equipo de la ficha técnica" value={placementId} disabled={disabled || !equipment.length || drawing.elements.length >= schema.MAX_DRAWING_ELEMENTS}
        onChange={event => changeTool(event.target.value ? 'inventory' : 'select', event.target.value)}>
        <option value="">{equipment.length ? 'Elegí un equipo para ubicar en el plano' : 'Todavía no hay equipos guardados en esta cuenta'}</option>
        {equipment.map(item => {
          const available = availableUnits(item)
          return <option key={item.id} value={item.id} disabled={!available}>{[equipmentName(item), item.brand, item.model, item.location].filter(Boolean).join(' · ')} · {available} de {item.quantity ?? 1} por ubicar</option>
        })}
      </select>
    </label>}
    {!readOnly && error && <p role="status">No se pudo actualizar el catálogo de productos. Los equipos de la ficha técnica siguen disponibles.</p>}
    {!readOnly && equipment.length > 0 && <ProductPhotos catalog={catalog} selected={placementItem} choices={equipment}
      photoChoice={item => ({ ...item, detail: [equipmentName(item), item.location, `${availableUnits(item)} por ubicar`].filter(Boolean).join(' · '), disabled: !availableUnits(item) })}
      disabled={disabled || drawing.elements.length >= schema.MAX_DRAWING_ELEMENTS} onChoose={id => changeTool('inventory', id)} />}
    {!readOnly && <div className="cctv-editor-toolbar" role="group" aria-label="Herramientas del plano">
      <button type="button" disabled={disabled} aria-pressed={tool === 'select'} onClick={() => changeTool('select')}>Seleccionar / mover</button>
      {Object.entries(schema.DRAWING_TYPES).filter(([type]) => type !== 'equipment').map(([type, label]) => <button key={type} type="button" disabled={disabled} aria-pressed={tool === type} onClick={() => changeTool(type)}>+ {label}</button>)}
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
    <p id={descriptionId} className="cctv-editor-help">{readOnly ? 'Plano de referencia de la instalación.' : placementHelp(tool, placementItem)}</p>
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
            {(element.brand || element.model) && <text x={element.x} y={element.y + 49} textAnchor="middle" className="cctv-plan-model">{[element.brand, element.model].filter(Boolean).join(' ')}</text>}
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
        {selected.equipmentId ? <><p className="cctv-plan-source">
          <strong>Vinculado a la ficha técnica</strong>
          {[linkedItem && equipmentName(linkedItem), selected.brand, selected.model].filter(Boolean).join(' · ')}
        </p>{linkedItem && <ProductPhotos catalog={catalog} selected={linkedItem} />}</> : (modelKinds || category === 'alarm' || perimeter) && <>
          {!perimeter && <label>{category === 'alarm' ? 'Marca de la alarma' : 'Marca del equipo'}<select disabled={disabled || loading || Boolean(error)} value={brand} onChange={event => updateSelected({ brand: event.target.value, model: '' })}>
            <option value="">Todas las marcas</option>
            {brand && !brands.includes(brand) && <option value={brand}>{brand}</option>}
            {brands.map(name => <option key={name}>{name}</option>)}
          </select></label>}
          <EquipmentModelInput key={`${selected.type}:${perimeter ? '' : brand}`} disabled={disabled} catalogUnavailable={Boolean(loading || error)}
            category={category} brand={brand} options={options} catalog={catalog} kindLabels={schema.EQUIPMENT_KINDS[category]}
            label={perimeter ? 'Modelo / SKU' : `Modelo ${brand}`.trim()} value={originalSelected?.model}
            onChange={(model, productBrand) => updateSelected({ model, brand: productBrand ?? brand })} />
        </>}
        <div className="cctv-editor-grid">
          {['x', 'y', ...(isSegment(selected.type) ? ['x2', 'y2'] : [])].map(coordinate => <label key={coordinate}>{({ x: 'Posición X', y: 'Posición Y', x2: 'Final X', y2: 'Final Y' })[coordinate]}<input type="number" min="0" max={coordinate.startsWith('x') ? 1000 : 650} disabled={disabled} value={selected[coordinate]} onChange={event => { if (event.target.value !== '' && event.target.validity.valid) updateSelected({ [coordinate]: Number(event.target.value) }) }} /></label>)}
          {!isSegment(selected.type) && <label>Orientación (°)<input type="number" min="0" max="360" disabled={disabled} value={selected.rotation || 0} onChange={event => { if (event.target.value !== '' && event.target.validity.valid) updateSelected({ rotation: Number(event.target.value) }) }} /></label>}
        </div>
        <div className="cctv-editor-toolbar"><button type="button" disabled={disabled} onClick={() => changeTool('move')}>Mover con un toque</button><button type="button" disabled={disabled || !canDuplicate} onClick={duplicateSelected}>Duplicar elemento</button><button type="button" disabled={disabled} onClick={() => { commit(removeDrawingElement(drawing, selectedId)); setSelectedId(''); changeTool('select') }}>Quitar elemento</button></div>
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
