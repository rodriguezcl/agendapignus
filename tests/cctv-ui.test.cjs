const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path'), Module = require('node:module')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const { parseDocument } = require('htmlparser2')
let ui
test.before(() => {
  const root = path.resolve(__dirname, '..')
  const bundled = require('esbuild').buildSync({ entryPoints: [path.join(root, 'src/features/cctv/presentation/CctvServices.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'cctv-ui-render.cjs'), module)
  compiled.paths = module.paths; compiled._compile(bundled.outputFiles[0].text, compiled.id); ui = compiled.exports
})
const author = { id: 'supervisor', name: 'Supervisión CCTV' }, admin = { id: 'admin', name: 'Administración' }
const fixture = (edit = true, download = true) => ({ customer: { customerId: 'customer-1', account: 'CLI-1', name: 'Cuenta Norte', address: 'Av. Central 12', cctvRequirement: 'Requiere llave de ingreso' }, capabilities: { edit, download }, dossier: {
  version: 3, updatedAt: '2026-11-25T15:00:00Z',
  news: [{ id: 'news-1', title: 'Informe de cámaras', body: 'Cámara norte revisada', at: '2026-11-25T15:00:00Z', author, file: { id: 'pdf-1', fileName: 'informe.pdf', mimeType: 'application/pdf' } }],
  maintenance: { observation: 'Revisar árbol del ingreso', nextDate: '2026-12-10', author, at: '2026-11-25T15:00:00Z' },
  plans: [{ id: 'plan-1', version: 1, title: 'Sector norte', notes: 'Ubicación de cámaras', author, at: '2026-11-25T15:00:00Z', file: { id: 'plan-file', fileName: 'plano.pdf' } }],
  improvements: [{ id: 'improve-1', title: 'Cambiar soporte', description: 'Soporte del ingreso', priority: 'Alta', completed: true, author, at: '2026-11-25T12:00:00Z', completedBy: admin, completedAt: '2026-11-25T15:00:00Z' }], equipment: [],
  activity: [{ id: 'activity-1', action: 'addNews', summary: 'Informe incorporado', at: '2026-11-25T15:00:00Z', author }, { id: 'activity-2', action: 'saveMaintenance', at: '2026-11-25T15:01:00Z', author: admin, details: { before: { observation: 'Revisión pendiente' }, after: { observation: 'Poda coordinada', nextDate: '2026-12-10' } } }]
} })
function nodes(node, predicate) { return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))] }
function render(tab, data = fixture()) { const html = renderToStaticMarkup(React.createElement(ui.CctvCustomerDetail, { customerId: 'customer-1', initialData: data, initialTab: tab })); return { html, document: parseDocument(html) } }

test('la ficha muestra los seis apartados, el requerimiento y una trazabilidad distinta por autor', () => {
  const { html, document } = render('general')
  assert.equal(nodes(document, node => node.attribs?.role === 'tab').length, 6)
  assert.match(html, /Requiere llave de ingreso/)
  assert.match(html, /Supervisión CCTV/)
  assert.match(html, /Administración/)
  assert.match(html, /Revisión pendiente/)
  assert.match(html, /Poda coordinada/)
  const entries = nodes(document, node => node.name === 'article' && node.attribs?.class?.includes('cctv-entry'))
  assert.equal(new Set(entries.map(node => node.attribs.style)).size, 2)
})

test('la consulta de novedades permite descargar sin mostrar opciones de edición', () => {
  const { html, document } = render('news', fixture(false, true))
  assert.equal(nodes(document, node => node.name === 'form').length, 0)
  assert.equal(nodes(document, node => node.name === 'input' && node.attribs?.type === 'file').length, 0)
  assert.match(html, /informe\.pdf/)
  const link = nodes(document, node => node.name === 'a')[0]
  assert.equal(link.attribs.href, '/api/cctv/attachments?customerId=customer-1&attachmentId=pdf-1')
  assert.match(html, /Buscar novedad/)
  assert.match(html, /Desde/)
  assert.match(html, /Hasta/)
  assert.equal(nodes(render('news', fixture(false, false)).document, node => node.name === 'a').length, 0)
})

test('una mejora realizada conserva la propuesta, el autor y la fecha de realización', () => {
  const { html, document } = render('improvements', fixture(false, true))
  assert.equal(nodes(document, node => node.name === 's').length, 1)
  const checkbox = nodes(document, node => node.name === 'input' && node.attribs?.type === 'checkbox')[0]
  assert.ok(Object.hasOwn(checkbox.attribs, 'checked'))
  assert.ok(Object.hasOwn(checkbox.attribs, 'disabled'))
  assert.match(html, /Realizada por Administración/)
  assert.match(html, /25\/11\/26, 12:00/)
})

test('los formularios mantienen los datos actuales y los planos anteriores quedan descargables', () => {
  const { document } = render('maintenance')
  assert.equal(nodes(document, node => node.name === 'textarea').length, 1)
  assert.equal(nodes(document, node => node.name === 'input' && node.attribs?.type === 'date')[0].attribs.value, '2026-12-10')
  const { html } = render('plans', fixture(false, true))
  assert.match(html, /Sector norte/)
  assert.match(html, /Versión 1/)
  assert.match(html, /attachmentId=plan-file/)
  assert.doesNotMatch(html, /Guardar nueva versión/)
})

test('las búsquedas ignoran acentos y las fechas de novedades respetan Buenos Aires', () => {
  const customers = [{ customerId: '1', account: 'CLI-1', name: 'Córdoba Norte', address: 'Central 12', pendingImprovements: 2 }, { customerId: '2', account: 'PIG-2', name: 'Sur', pendingImprovements: 0 }]
  assert.equal(ui.filterCctvCustomers(customers, 'cordoba')[0].customerId, '1')
  assert.equal(ui.filterCctvCustomers(customers, '', true).length, 1)
  const news = [{ id: 'early', title: 'Cámara', body: 'Ingreso', at: '2026-11-26T01:00:00Z', file: { fileName: 'norte.pdf' } }, { id: 'late', title: 'Otro', at: '2026-11-26T15:00:00Z' }]
  assert.deepEqual(ui.filterCctvNews(news, { search: 'norte.pdf', from: '2026-11-25', to: '2026-11-25' }).map(item => item.id), ['early'])
  assert.deepEqual(ui.filterCctvNews(news).map(item => item.id), ['late', 'early'])
})

test('el esquema guardado puede servir de base sin alterar su versión original', () => {
  const data = fixture(), plan = data.dossier.plans[0]
  plan.drawing = { width: 1000, height: 650, elements: [{ id: 'camera-1', type: 'camera', x: 50, y: 90, label: 'Ingreso' }] }
  const copy = ui.cctvPlanDraftFromVersion(plan)
  assert.equal(copy.title, plan.title)
  assert.equal(copy.notes, plan.notes)
  assert.equal(copy.file, null)
  copy.drawing.elements[0].label = 'Portón'
  assert.equal(plan.drawing.elements[0].label, 'Ingreso')
  assert.match(render('plans', data).html, /Usar como base/)
  data.capabilities.edit = false
  assert.doesNotMatch(render('plans', data).html, /Usar como base/)
})

test('datos generales incluye contactos y el historial conserva ambos inventarios sin editores', () => {
  const data = fixture(false)
  Object.assign(data.customer, { phone: '111', contact: 'Guardia', contactName: 'Persona del ingreso', contactPhone: '222' })
  const base = { id: 'camera-1', category: 'cctv', kind: 'camera', quantity: 1, details: {}, label: 'Ingreso' }
  data.dossier.activity.push({ id: 'equipment-history', action: 'saveEquipment', at: '2026-11-25T15:05:00Z', author, details: { before: [{ ...base, model: 'Modelo anterior' }], after: [{ ...base, model: 'Modelo nuevo' }] } })
  const { html, document } = render('general', data)
  for (const text of ['Guardia', 'Persona del ingreso', '222', 'Inventario registrado', 'Inventario anterior', 'Modelo anterior', 'Modelo nuevo']) assert.ok(html.includes(text), text)
  assert.equal(nodes(document, node => node.name === 'input' || node.name === 'textarea' || node.name === 'select').length, 0)
  assert.doesNotMatch(html, /Quitar equipo|Agregar equipo/)
})

test('los nombres accesibles de selectores y observaciones no dependen del contenido guardado', () => {
  const data = fixture()
  data.dossier.equipment = [{ id: 'cam-1', category: 'cctv', kind: 'camera', quantity: 1, notes: 'Ingreso revisado', details: { technology: 'IP' } }]
  for (const tab of ['news', 'maintenance', 'plans', 'improvements', 'equipment']) {
    const fields = nodes(render(tab, data).document, node => node.name === 'textarea' || node.name === 'select')
    assert.ok(fields.length > 0)
    for (const field of fields) assert.ok(field.attribs['aria-label'], `${tab}: ${field.name} requiere un nombre estable`)
  }
  const maintenance = nodes(render('maintenance', data).document, node => node.name === 'textarea')[0]
  assert.equal(maintenance.attribs['aria-label'], 'Observaciones')
  const type = nodes(render('equipment', data).document, node => node.name === 'select' && node.attribs['aria-label'] === 'Tipo de equipo')
  assert.equal(type.length, 1)
})

const cleanDrafts = () => ({ news: { title: '', body: '', file: null }, plans: { title: '', notes: '', file: null, drawing: null }, improvements: { title: '', description: '', priority: 'Normal' }, maintenance: { observation: 'Observación original', nextDate: '' }, equipment: [{ id: 'old', model: 'Equipo original' }] })

test('actualizar un conflicto conserva la novedad sin guardar y renueva el inventario que no se había editado', () => {
  const baseline = cleanDrafts(), drafts = structuredClone(baseline)
  drafts.news = { title: 'Inspección nueva', body: 'Texto sin guardar', file: { fileName: 'informe.pdf', data: 'ZmlsZQ==' } }
  const dossier = { equipment: [{ id: 'new', model: 'Equipo agregado por otra sesión' }], maintenance: { observation: 'Mantenimiento actualizado', nextDate: '2026-12-15' } }
  const result = ui.rebaseCctvDrafts({ drafts, baseline, dossier })
  assert.deepEqual(result.drafts.news, drafts.news)
  assert.deepEqual(result.baseline.news, baseline.news)
  assert.deepEqual(result.drafts.equipment, dossier.equipment)
  assert.deepEqual(result.baseline.equipment, dossier.equipment)
  assert.deepEqual(result.drafts.maintenance, dossier.maintenance)
  assert.deepEqual(baseline.equipment, [{ id: 'old', model: 'Equipo original' }])
  result.drafts.equipment[0].model = 'Edición local posterior'
  assert.equal(result.baseline.equipment[0].model, 'Equipo agregado por otra sesión')
  assert.equal(dossier.equipment[0].model, 'Equipo agregado por otra sesión')
})

test('un inventario modificado se conserva completo al revisar un conflicto, sin mezclar equipos remotos', () => {
  const baseline = cleanDrafts(), drafts = structuredClone(baseline)
  drafts.equipment.push({ id: 'local', model: 'Equipo sin guardar' })
  const result = ui.rebaseCctvDrafts({ drafts, baseline, dossier: { equipment: [{ id: 'remote', model: 'Otro equipo' }] } })
  assert.deepEqual(result.drafts.equipment, drafts.equipment)
  assert.deepEqual(result.baseline.equipment, baseline.equipment)
  assert.notDeepEqual(result.drafts.equipment, result.baseline.equipment)
})

test('guardar una sección limpia su borrador, renueva los apartados intactos y conserva otras ediciones', () => {
  const baseline = cleanDrafts(), drafts = structuredClone(baseline)
  drafts.news = { title: 'Novedad enviada', body: 'Observación', file: null }
  drafts.plans = { ...drafts.plans, title: 'Plano todavía sin guardar', notes: 'Mantener' }
  const dossier = { equipment: [{ id: 'server', model: 'Inventario actual' }], maintenance: { observation: 'Observación vigente', nextDate: '2027-01-05' } }
  const result = ui.rebaseCctvDrafts({ drafts, baseline, dossier, savedSection: 'news' })
  assert.deepEqual(result.drafts.news, baseline.news)
  assert.deepEqual(result.drafts.news, result.baseline.news)
  assert.deepEqual(result.drafts.plans, drafts.plans)
  assert.deepEqual(result.baseline.plans, baseline.plans)
  assert.deepEqual(result.drafts.equipment, dossier.equipment)
  assert.deepEqual(result.drafts.maintenance, dossier.maintenance)
  const savedEquipment = ui.rebaseCctvDrafts({ drafts: { ...drafts, equipment: [{ id: 'local', model: 'Guardando' }] }, baseline, dossier, savedSection: 'equipment' })
  assert.deepEqual(savedEquipment.drafts.equipment, dossier.equipment)
  assert.deepEqual(savedEquipment.baseline.equipment, dossier.equipment)
})
