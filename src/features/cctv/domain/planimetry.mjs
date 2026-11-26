import schema from '../../../../shared/cctv-schema.cjs'

export const { defaultDrawing } = schema
export const isSegment = type => schema.DRAWING_SEGMENTS.includes(type)
export const segmentStyles = {
  line: { stroke: '#64748b', strokeWidth: 3 },
  wall: { stroke: '#334155', strokeWidth: 8 },
  door: { stroke: '#96612b', strokeWidth: 6 },
  window: { stroke: '#0284c7', strokeWidth: 5 },
  cable: { stroke: '#7c3aed', strokeWidth: 3, strokeDasharray: '9 6' },
  area: { stroke: '#187558', strokeWidth: 2, fill: '#d9f4e6', fillOpacity: 0.45 }
}
export const segmentBounds = ({ x, y, x2, y2 }) => ({ x: Math.min(x, x2), y: Math.min(y, y2), width: Math.abs(x2 - x), height: Math.abs(y2 - y) })
export const drawingLayers = elements => [...elements.filter(element => element.type === 'area'), ...elements.filter(element => element.type !== 'area')]
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
export const drawingPoint = (clientX, clientY, rect) => ({ x: Math.round(clamp((clientX - rect.left) / rect.width * 1000, 0, 1000)), y: Math.round(clamp((clientY - rect.top) / rect.height * 650, 0, 650)) })
export function moveDrawingElement(drawing, id, x, y) {
  return { ...drawing, elements: drawing.elements.map(element => {
    if (element.id !== id) return element
    const segment = isSegment(element.type)
    const xs = segment ? [element.x, element.x2] : [element.x]
    const ys = segment ? [element.y, element.y2] : [element.y]
    const dx = clamp(x - element.x, -Math.min(...xs), drawing.width - Math.max(...xs))
    const dy = clamp(y - element.y, -Math.min(...ys), drawing.height - Math.max(...ys))
    return { ...element, x: element.x + dx, y: element.y + dy, ...(segment ? { x2: element.x2 + dx, y2: element.y2 + dy } : {}) }
  }) }
}
export const removeDrawingElement = (drawing, id) => ({ ...drawing, elements: drawing.elements.filter(element => element.id !== id) })
export const symbolPath = type => ({
  camera: 'M-17-10h24v20h-24z M7-5l13-8v26L7 5 M-11 14h14 M-4 10v4',
  recorder: 'M-21-14h42v28h-42z M-15-6H8 M-15 2H8 M13-5h3 M13 3h3',
  alarm: 'M-13 9c5-7-2-21 13-21S8 2 13 9z M-4 14h8 M0-16v4',
  barrier: 'M-20-18h6v36h-6z M14-18h6v36h-6z M-11-12h22 M-11 0h22 M-11 12h22',
  fence: 'M-21-14v32 M0-14v32 M21-14v32 M-24-8h48 M-24 1h48 M-24 10h48',
}[type] || '')
const xml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]))
export function drawingSvg(value) {
  const drawing = schema.validateDrawing(value)
  const elements = drawingLayers(drawing.elements).map(element => {
    if (isSegment(element.type)) {
      const { stroke, strokeWidth, strokeDasharray, fill, fillOpacity } = segmentStyles[element.type]
      const style = `stroke="${stroke}" stroke-width="${strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ''}`
      const { x, y, width, height } = segmentBounds(element)
      const shape = element.type === 'area'
        ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" fill-opacity="${fillOpacity}" ${style}/>`
        : `<line x1="${element.x}" y1="${element.y}" x2="${element.x2}" y2="${element.y2}" ${style}/>`
      return `<g>${shape}<text text-anchor="middle" x="${x + width / 2}" y="${y + height / 2 - 8}">${xml(element.label)}</text></g>`
    }
    const shape = element.type === 'text' ? '' : `<path d="${symbolPath(element.type)}" transform="rotate(${element.rotation || 0} ${element.x} ${element.y}) translate(${element.x} ${element.y})" fill="none" stroke="#1e4b63" stroke-width="2.5"/>`
    const y = element.y + (element.type === 'text' ? 0 : 33)
    const model = element.model ? `<text x="${element.x}" y="${y + 16}" text-anchor="middle" font-size="11">${xml([element.brand, element.model].filter(Boolean).join(' '))}</text>` : ''
    return `${shape}<text x="${element.x}" y="${y}" text-anchor="middle">${xml(element.label)}</text>${model}`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650" role="img" aria-label="Plano de equipos"><rect width="1000" height="650" fill="white"/><g font-family="Arial,sans-serif" font-size="14" fill="#172e40">${elements}</g></svg>`
}
