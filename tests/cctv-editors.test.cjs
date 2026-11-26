const test = require('node:test')
const assert = require('node:assert/strict')
const schema = require('../shared/cctv-schema.cjs')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const drawingModule = () => import(pathToFileURL(path.join(__dirname, '../src/features/cctv/domain/planimetry.mjs')).href)
const equipmentModule = () => import(pathToFileURL(path.join(__dirname, '../src/features/cctv/domain/equipment.mjs')).href)
const camera = () => ({ id: 'camera-1', type: 'camera', x: 400, y: 300, label: 'Ingreso', rotation: 90 })
const recorder = () => ({ id: 'recorder-1', category: 'cctv', kind: 'nvr', label: 'Grabador principal', brand: 'Marca', model: 'Modelo', quantity: 1, location: 'Sala de control', details: { channels: 16, diskCount: 2, diskCapacityTb: 4 }, notes: '' })

test('schema admite categorías técnicas y barreras exclusivamente infrarrojas con campos específicos', () => {
  const items = [recorder(), { ...recorder(), id: 'barrier', category: 'barrier', kind: 'infrared', details: { rangeMeters: 80, beams: 4, pairs: 2, zone: 'Ingreso' } }, { ...recorder(), id: 'fence', category: 'fence', kind: 'energizer', details: { perimeterMeters: 200.5, wireLines: 6, zones: 2, battery: '12 V / 7 Ah' } }]
  assert.deepEqual(schema.validateEquipmentItems(items), items)
  assert.throws(() => schema.validateEquipmentItems([{ ...items[1], kind: 'vehicular' }]), { code: 'CCTV_VALIDATION' })
  assert.throws(() => schema.validateEquipmentItems([{ ...items[1], details: { motor: 'Motor' } }]), /no está permitido/)
  assert.throws(() => schema.validateEquipmentItems([{ ...items[0], details: { password: 'private' } }]), /no está permitido/)
})

test('el catálogo de alarmas identifica marca y familia y los componentes se pueden registrar por conexión', () => {
  const models = require('../src/features/cctv/domain/alarm-models.json')
  assert.deepEqual(Object.keys(models), ['Ajax', 'DSC', 'Garnet', 'Hikvision', 'Netio'])
  assert.ok(models.Netio.communicator.includes('NT-Link 4G'))
  assert.ok(models.DSC.panel.includes('HS2032'))
  assert.ok(models.Garnet.expander.includes('EXP-8Z'))
  assert.ok(models.Ajax.sensor.includes('Superior MotionProtect Fibra'))
  assert.ok(models.Hikvision.receiver.includes('DS-PM1-RT-HWB'))
  for (const groups of Object.values(models)) for (const [kind, entries] of Object.entries(groups)) {
    assert.ok(Object.hasOwn(schema.EQUIPMENT_KINDS.alarm, kind))
    assert.equal(new Set(entries).size, entries.length)
    assert.ok(entries.length && entries.every(entry => entry.trim() && entry.length <= 100))
  }
  const item = { ...recorder(), category: 'alarm', kind: 'keypad', brand: 'DSC', model: 'HS2LCD', details: { alarmConnection: 'Cableada' } }
  assert.deepEqual(schema.validateEquipmentItems([item]), [item])
  assert.throws(() => schema.validateEquipmentItems([{ ...item, category: 'other', kind: 'other' }]), { code: 'CCTV_VALIDATION' })
})

test('el catálogo de IR Seguridad agrupa barreras y cercos con SKU únicos y fichas del proveedor', () => {
  const { barrier, fence } = require('../src/features/cctv/domain/ir-perimeter-models.json')
  const products = [...barrier.infrared, ...Object.values(fence).flat()]
  assert.equal(new Set(products.map(product => product.model)).size, products.length)
  assert.ok(products.every(product => product.url.startsWith('https://irseguridad.com.ar/producto/')))
  assert.equal(barrier.infrared.find(product => product.model === 'B60').brand, 'Dumont')
  assert.ok(barrier.infrared.some(product => product.model === 'IR-BARRAL 460'))
  assert.ok(!barrier.infrared.some(product => product.model === 'PROBG3030R'))
  assert.equal(fence.energizer.find(product => product.model === 'ELC6012 NET').brand, 'Intelbras')
  assert.ok(fence.accessory.some(product => product.model === 'ME-05 WB'))
  assert.ok(fence.fence.some(product => product.model === '70CM107'))
})

test('schema rechaza límites, duplicados, números no finitos, objetos inesperados e inyección de estructura', () => {
  assert.deepEqual(schema.validateDrawing(null), schema.defaultDrawing())
  assert.deepEqual(schema.validateEquipmentItems(null), [])
  const draw = { ...schema.defaultDrawing(), elements: [camera()] }
  for (const element of [{ ...camera(), x: -1 }, { ...camera(), y: 651 }, { ...camera(), rotation: Infinity }, { ...camera(), type: 'svg' }, { ...camera(), onload: 'attack()' }, { ...camera(), id: '" bad' }, { ...camera(), type: 'line' }]) assert.throws(() => schema.validateDrawing({ ...draw, elements: [element] }), { code: 'CCTV_VALIDATION' })
  assert.throws(() => schema.validateDrawing({ ...draw, elements: [camera(), camera()] }), /repetidos/)
  assert.throws(() => schema.validateDrawing({ ...draw, elements: Array.from({ length: 201 }, (_, index) => ({ ...camera(), id: `i${index}` })) }), /200/)
  assert.throws(() => schema.validateDrawing({ ...draw, background: '<svg/>' }), /no está permitido/)
  assert.throws(() => schema.validateEquipmentItems(Array.from({ length: 101 }, (_, index) => ({ ...recorder(), id: `i${index}` }))), /100/)
  for (const item of [{ ...recorder(), quantity: 0 }, { ...recorder(), quantity: 1.5 }, { ...recorder(), details: { channels: NaN } }, { ...recorder(), details: { channels: 1025 } }, { ...recorder(), notes: 'a'.repeat(3001) }, { ...recorder(), category: '__proto__' }]) assert.throws(() => schema.validateEquipmentItems([item]), { code: 'CCTV_VALIDATION' })
  assert.throws(() => schema.validateEquipmentItems([recorder(), recorder()]), /repetidos/)
  assert.throws(() => schema.validateEquipmentItems([JSON.parse('{"id":"x","category":"cctv","kind":"nvr","__proto__":{"polluted":true}}')]), /no está permitido/)
  assert.equal({}.polluted, undefined)
})

test('movimiento limita ambas puntas de la línea, conserva longitud y no muta el plano', async () => {
  const { moveDrawingElement, removeDrawingElement, drawingPoint } = await drawingModule()
  const line = { id: 'line-1', type: 'line', x: 100, y: 100, x2: 300, y2: 200, label: 'Cableado' }
  const drawing = { ...schema.defaultDrawing(), elements: [camera(), line] }, before = structuredClone(drawing)
  const moved = moveDrawingElement(drawing, line.id, 2000, 2000)
  assert.deepEqual(moved.elements[1], { ...line, x: 800, y: 550, x2: 1000, y2: 650 })
  assert.deepEqual(drawing, before)
  assert.doesNotThrow(() => schema.validateDrawing(moved))
  const negative = moveDrawingElement(drawing, line.id, -2000, -2000)
  assert.deepEqual(negative.elements[1], { ...line, x: 0, y: 0, x2: 200, y2: 100 })
  assert.deepEqual(removeDrawingElement(drawing, camera().id).elements, [line])
  assert.deepEqual(drawingPoint(250, 200, { left: 0, top: 0, width: 500, height: 325 }), { x: 500, y: 400 })
})

test('SVG se construye con geometría validada y escapa etiquetas maliciosas', async () => {
  const { drawingSvg } = await drawingModule()
  const label = '</text><script>alert("x")</script>&'
  const result = drawingSvg({ ...schema.defaultDrawing(), elements: [{ ...camera(), label }] })
  assert.ok(result.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(result.includes('&lt;/text&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;'))
  assert.doesNotMatch(result, /<script|foreignObject|onload=|href=/)
  assert.throws(() => drawingSvg({ ...schema.defaultDrawing(), elements: [{ ...camera(), x: '0" onload="x' }] }), { code: 'CCTV_VALIDATION' })
})

test('el plano conserva las herramientas nuevas y el modelo al validar, mover y exportar', async () => {
  const { drawingSvg, moveDrawingElement } = await drawingModule()
  const types = ['wall', 'door', 'window', 'cable', 'area']
  const architecture = types.map(type => ({ id: type, type, x: 50, y: 60, x2: 250, y2: 210, label: type }))
  const model = 'IPC-HFW3449T1-AS-PV-PRO'
  const alarm = { id: 'alarm', type: 'alarm', x: 70, y: 90, label: 'Panel central', brand: 'DSC', model: 'HS2032' }
  const barrier = { id: 'barrier', type: 'barrier', x: 150, y: 140, label: 'Ingreso', brand: 'Dumont', model: 'B60' }
  const fence = { id: 'fence', type: 'fence', x: 220, y: 140, label: 'Perímetro', brand: 'Intelbras', model: 'ELC6012 NET' }
  const drawing = { ...schema.defaultDrawing(), elements: [{ ...camera(), model }, alarm, barrier, fence, ...architecture] }
  assert.deepEqual(schema.validateDrawing(drawing), drawing)
  assert.throws(() => schema.validateDrawing({ ...drawing, elements: [{ ...architecture[0], model }] }), { code: 'CCTV_VALIDATION' })
  const moved = moveDrawingElement(drawing, 'area', 999, 900)
  assert.deepEqual(moved.elements.at(-1), { ...architecture.at(-1), x: 800, y: 500, x2: 1000, y2: 650 })
  const exported = drawingSvg(moved)
  assert.match(exported, /stroke-dasharray="9 6"/)
  assert.match(exported, /<rect x="800" y="500" width="200" height="150"/)
  assert.ok(exported.includes(model))
  assert.ok(exported.includes('DSC HS2032'))
  assert.ok(exported.includes('Dumont B60'))
  assert.ok(exported.includes('Intelbras ELC6012 NET'))
})

test('cambiar tipo conserva campos comunes y reordenar o quitar usa identificadores sin perder otros equipos', async () => {
  const { changeEquipmentKind, reorderEquipment, removeEquipment, newEquipmentItem } = await equipmentModule()
  const first = recorder(), second = { ...recorder(), id: 'second', model: 'Modelo 2' }, items = [first, second]
  const changed = changeEquipmentKind({ ...first, kind: 'xvr', details: { ...first.details, technology: 'Híbrida' } }, 'cctv', 'nvr')
  assert.deepEqual(changed.details, first.details)
  assert.equal(changed.brand, first.brand)
  assert.deepEqual(changeEquipmentKind(first, 'barrier').details, {})
  assert.deepEqual(reorderEquipment(items, first.id, 1), [second, first])
  assert.deepEqual(removeEquipment(items, first.id), [second])
  assert.deepEqual(items, [first, second])
  assert.equal(reorderEquipment(items, first.id, -1), items)
  assert.equal(newEquipmentItem('barrier', 'b1').kind, 'infrared')
  assert.doesNotThrow(() => schema.validateEquipmentItems([newEquipmentItem('barrier', 'b1')]))
})

test('editores renderizan consulta sin acciones de edición, texto escapado y controles accesibles al editar', () => {
  const { buildSync } = require('esbuild'), Module = require('node:module'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const output = buildSync({ stdin: { contents: "export {default as PlanimetryEditor} from './src/features/cctv/presentation/PlanimetryEditor.jsx'; export {default as EquipmentEditor} from './src/features/cctv/presentation/EquipmentEditor.jsx';", resolveDir: path.join(__dirname, '..'), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, loader: { '.css': 'empty' } }).outputFiles[0].text
  const loaded = new Module(__filename); loaded.paths = module.paths; loaded._compile(output, __filename)
  const { PlanimetryEditor, EquipmentEditor } = loaded.exports
  const drawing = { ...schema.defaultDrawing(), elements: [{ ...camera(), label: '<img src=x onerror=attack()>' }] }
  const plan = renderToStaticMarkup(React.createElement(PlanimetryEditor, { value: drawing, readOnly: true }))
  assert.ok(plan.includes('&lt;img src=x onerror=attack()&gt;'))
  assert.doesNotMatch(plan, /<input|<select|Quitar elemento|Seleccionar \/ mover/)
  const noDownload = renderToStaticMarkup(React.createElement(PlanimetryEditor, { value: drawing, readOnly: true, allowDownload: false }))
  assert.doesNotMatch(noDownload, /Descargar plano SVG/)
  assert.match(noDownload, /Plano de ubicación de los equipos/)
  const equipment = renderToStaticMarkup(React.createElement(EquipmentEditor, { value: [recorder()], readOnly: true }))
  assert.match(equipment, /Capacidad por disco \(TB\)/)
  assert.doesNotMatch(equipment, /<input|<select|Quitar equipo|Agregar equipo/)
  const editable = renderToStaticMarkup(React.createElement(PlanimetryEditor, { value: drawing, onChange() {} }))
  assert.match(editable, /Elemento seleccionado/)
  assert.match(editable, /role="group" aria-label="Herramientas del plano"/)
  assert.match(editable, /Duplicar elemento|Ajustar a cuadrícula/)
  const dahua = renderToStaticMarkup(React.createElement(EquipmentEditor, { value: [{ ...recorder(), brand: 'Dahua', model: 'NVR5208-EI' }] }))
  assert.match(dahua, /Buscar en el catálogo/)
  assert.match(dahua, /NVR5208-EI/)
  assert.match(dahua, /Ingresar modelo manualmente/)
  const netio = renderToStaticMarkup(React.createElement(EquipmentEditor, {
    value: [{ ...recorder(), category: 'alarm', kind: 'communicator', brand: 'Netio', model: 'NT-Link 4G', details: { alarmConnection: 'Híbrida' } }]
  }))
  assert.match(netio, /Modelo Netio/)
  assert.match(netio, /Tipo de conexión/)
  assert.match(netio, /NT-Com 3 4G/)
  const irEquipment = renderToStaticMarkup(React.createElement(EquipmentEditor, {
    value: [{ ...recorder(), category: 'fence', kind: 'energizer', brand: '', model: 'ELC6012 NET', details: {} }]
  }))
  assert.match(irEquipment, /Modelo \/ SKU de IR Seguridad/)
  assert.match(irEquipment, /ELC6012 NET · Intelbras/)
  assert.match(irEquipment, /Ver ficha en IR Seguridad/)
  const disabled = renderToStaticMarkup(React.createElement(EquipmentEditor, { value: [recorder()], disabled: true }))
  assert.match(disabled, /<input disabled=""/)
})
