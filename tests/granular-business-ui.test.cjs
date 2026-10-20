const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const policy = require('../api/_lib/permission-catalog.cjs')
const root = path.resolve(__dirname, '..')
const cache = new Map()
const noop = () => {}
const userWith = (...keys) => ({
  id: 'viewer', roleCode: 'operator',
  permissions: Object.fromEntries([['__catalogV2', true], ...keys.map(key => [key, true])])
})
function bundle(file, extra = '') {
  const key = file + extra
  if (cache.has(key)) return cache.get(key)
  const filename = path.join(root, file)
  const source = fs.readFileSync(filename, 'utf8')
  const provider = path.relative(path.dirname(filename), path.join(root, 'src/presentation/contexts/permissions-context.jsx')).replaceAll('\\', '/')
  const result = require('esbuild').buildSync({
    stdin: { contents: `${source}\n${extra}\nexport { PermissionsProvider } from '${provider}';`, loader: 'jsx', resolveDir: path.dirname(filename) },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent'
  })
  const compiled = new Module(path.join(root, 'granular-ui-render.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, path.join(root, 'granular-ui-render.cjs'))
  cache.set(key, compiled.exports)
  return compiled.exports
}
function render(file, name, props, user, extra) {
  const exports = bundle(file, extra)
  const component = React.createElement(exports[name], props)
  return renderToStaticMarkup(user ? React.createElement(exports.PermissionsProvider, { user }, component) : component)
}
const customer = { customerId: 'c1', account: 'CLI-1', name: 'CLIENTE QA', kind: 'client', street: 'Dirección reservada', address: 'Dirección reservada', phone: '555-privado', type: '', locality: '', province: '' }
const service = { id: 's1', name: 'Servicio QA', description: '', estimatedMinutes: 60, status: 'Activo' }
const record = { id: 'r1', date: '2020-01-01', time: '09:00', client: 'CLI-1 CLIENTE QA', customerId: 'c1', serviceId: 's1', service: service.name, status: 'Pendiente', technicianIds: ['viewer'], technicians: ['Técnico QA'], estimatedMinutes: 60, address: customer.address, phone: customer.phone, amount: 12345, paymentMethod: 'Efectivo', monthlyFee: 98765, formEmail: 'privado@example.test' }

test('clientes separa crear, editar coordenadas, CCTV, borrar e historial', () => {
  const props = { customers: [customer], history: [], services: [], teams: [], weekly: {}, setCustomers: noop, setNotice: noop, ask: noop }
  const read = render('src/features/customers/presentation/Accounts.jsx', 'Accounts', props, userWith('accounts.view'))
  assert.doesNotMatch(read, /Nuevo cliente|Deshacer última importación|Importar abonados|Solicitá eliminar|Ver historial de servicios/)
  const create = render('src/features/customers/presentation/Accounts.jsx', 'Accounts', props, userWith('accounts.view', 'customers.create'))
  assert.match(create, /Nuevo cliente/)
  assert.doesNotMatch(create, /Abrí el formulario para modificar/)
  const coordinates = render('src/features/customers/presentation/Accounts.jsx', 'CustomerForm', { form: customer, editing: 'c1', customers: [customer], setForm: noop, save: noop, cancel: noop }, userWith('accounts.view', 'customers.coordinates'))
  assert.match(coordinates, /disabled="" value="CLIENTE QA"/)
  assert.match(coordinates, /Latitud/)
  assert.match(coordinates, /type="checkbox" disabled=""/)
})

test('empleados permite contraseña sin editar contacto, rol o capacidad técnica', () => {
  const roles = [{ id: 'operator', name: 'Operador', code: 'operator' }]
  const props = { form: { firstName: 'QA', lastName: 'Usuario', email: 'qa@example.test', roleId: 'operator', technicalEnabled: false }, roles, editing: 'e1', setForm: noop, save: noop, cancel: noop }
  const html = render('src/features/employees/presentation/Employees.jsx', 'EmployeeForm', props, userWith('employees.view', 'employees.password'), 'export { EmployeeForm };')
  assert.match(html, /disabled="" value="QA"/)
  assert.match(html, /<select disabled=""/)
  assert.match(html, /type="checkbox" disabled=""/)
  assert.doesNotMatch(html.match(/<input[^>]*type="password"[^>]*>/)[0], /disabled/)
  const readonly = render('src/features/employees/presentation/Employees.jsx', 'default', { employees: [], roles, history: [], teams: [], weekly: {}, setEmployees: noop, setNotice: noop, ask: noop }, userWith('employees.view'))
  assert.doesNotMatch(readonly, /Nuevo colaborador/)
})

test('catálogo permite editar duración sin crear, borrar ni cambiar estado', () => {
  const html = render('src/features/services/presentation/ServiceTypes.jsx', 'default', { services: [service], setServices: noop, setNotice: noop, ask: noop }, userWith('services.view', 'services.duration'))
  assert.match(html, /aria-label="Editar Servicio QA"/)
  assert.doesNotMatch(html, /Nuevo servicio|aria-label="Eliminar/)
  assert.match(html, /disabled="" aria-label="Desactivar Servicio QA"/)
})

test('cobranza separa confirmar, importe, medio de pago y trazabilidad', () => {
  const props = { record, serviceDate: record.date, canManage: true, onSave: noop, close: noop, onSaved: noop }
  const user = userWith('collections.view', 'records.financial', 'collections.confirm')
  const confirm = render('src/components/Collections.jsx', 'CollectionEditor', props, user, 'export { CollectionEditor };')
  assert.match(confirm, /Confirmar pago/)
  assert.doesNotMatch(confirm, /Guardar corrección|Historial de la cobranza/)
  assert.match(confirm, /<input disabled="" required="" type="text"/)
  assert.match(confirm, /<select disabled="" required=""/)
  const amount = render('src/components/Collections.jsx', 'CollectionEditor', props, userWith('collections.view', 'records.financial', 'collections.amount'), 'export { CollectionEditor };')
  assert.match(amount, /Guardar corrección/)
  assert.doesNotMatch(amount, /Confirmar pago/)
  assert.doesNotMatch(amount.match(/<input[^>]*type="text"[^>]*>/)[0], /disabled/)
  assert.match(amount, /<select disabled="" required=""/)
})

test('historial oculta contacto, finanzas, informes y fotografías independientemente', () => {
  const html = render('src/features/history/presentation/HistoryDetail.jsx', 'HistoryDetail', {
    record: { ...record, technicalObservation: 'Informe privado', servicePhotoUrl: '/api/photo/secret' }, customers: [], close: noop
  }, userWith('history.view', 'records.read'))
  assert.doesNotMatch(html, /Dirección reservada|555-privado|12345|98765|privado@example|Informe privado|api\/photo\/secret|Monto a abonar|Forma de pago/)
})

test('historial permite completar sin editar y bloquea registros fuera del alcance de escritura', () => {
  const props = { record, customers: [customer], services: [service], employees: [], setHistory: noop, close: noop, persistHistoryRecord: noop, authUser: { id: 'viewer' } }
  const user = userWith('history.view', 'records.read', 'history.complete', 'scope.services.write.assigned')
  const html = render('src/features/history/presentation/HistoryManagementDetail.jsx', 'HistoryManagementDetail', props, user)
  assert.match(html, /Marcar completado/)
  assert.doesNotMatch(html, /Editar datos|Cancelar servicio|Eliminar registro|>Reprogramar</)
  const other = render('src/features/history/presentation/HistoryManagementDetail.jsx', 'HistoryManagementDetail', { ...props, record: { ...record, technicianIds: ['other'] } }, user)
  assert.doesNotMatch(other, /Marcar completado/)
  const notes = render('src/features/history/presentation/HistoryManagementDetail.jsx', 'HistoryManagementDetail', props, userWith('history.view', 'records.read', 'planning.notes'))
  assert.match(notes, /Editar datos/)
  assert.doesNotMatch(notes, /Marcar completado|Cancelar servicio|Eliminar registro/)
})

test('selección masiva requiere permiso bulk además de acciones individuales', () => {
  const props = { history: [record], customers: [customer], services: [service], employees: [], setHistory: noop, persistHistoryRecord: noop, authUser: {} }
  const html = render('src/features/history/presentation/History.jsx', 'HistoryBulkView', props, userWith('history.view', 'records.read', 'history.cancel'))
  assert.doesNotMatch(html, /Seleccionar esta página|Gestionar selección|type="checkbox"/)
})

test('documentos de vehículos y servicios usan permisos distintos', () => {
  const props = { files: [], onChange: noop }
  const user = userWith('vehicles.view', 'vehicle.documents.read', 'vehicle.documents.upload')
  assert.equal(render('src/components/Attachments.jsx', 'AttachmentDraftField', props, user), '')
  assert.match(render('src/components/Attachments.jsx', 'AttachmentDraftField', { ...props, scope: 'vehicle' }, user), /Agregar archivos/)
  assert.equal(render('src/components/Attachments.jsx', 'default', { entityId: 'r1' }, user), '')
})

test('flota separa edición, kilometraje, controles, seguro y eliminación', () => {
  const props = { vehicles: [{ id: 'v1', brand: 'Marca', model: 'Modelo', year: 2024, plate: 'QA123', mileage: 1000, insuranceFileName: 'seguro.pdf' }], history: [], setVehicles: noop, setNotice: noop, ask: noop }
  const readonly = render('src/features/vehicles/presentation/Vehicles.jsx', 'Vehicles', props, userWith('vehicles.view'))
  assert.doesNotMatch(readonly, /Nuevo vehículo|Ver estadísticas|Historial de fotos|Descargar PDF|Solicitá quitar este vehículo|Abrí el formulario para modificar/)
  const mileage = render('src/features/vehicles/presentation/Vehicles.jsx', 'Vehicles', props, userWith('vehicles.view', 'vehicles.mileage.read', 'vehicles.mileage.edit'))
  assert.match(mileage, /Ver estadísticas/)
  assert.match(mileage, /Abrí el formulario para modificar/)
  assert.doesNotMatch(mileage, /Nuevo vehículo|Historial de fotos|Descargar PDF|Solicitá quitar este vehículo/)
})

test('ficha de cliente y detalle por ubicación ocultan abonos sin lectura financiera', () => {
  const history = [{ ...record, status: 'Completado', service: 'Instalación de alarma', installationZone: 'residencial' }]
  const detail = render('src/features/customers/presentation/CustomerDetail.jsx', 'CustomerDetail', {
    customer: { ...customer, fields: { Localidad: 'Córdoba', 'Monto del abono': 'Saldo privado' } }, history, services: [service], close: noop, onCorrectSubscription: noop
  }, userWith('accounts.view'))
  assert.doesNotMatch(detail, /Abono mensual|Saldo privado|Corregir datos del abono/)
  const location = render('src/components/LocationInstallationsModal.jsx', 'default', {
    records: history, category: 'all', label: 'Todas', month: '2020-01', zoneOf: () => 'residencial', close: noop
  }, userWith('dashboard.view', 'records.read', 'dashboard.detail'))
  assert.doesNotMatch(location, /Abono mensual|Meses congelados|Dirección reservada|555-privado/)
})

test('cobranza fuera del alcance de escritura permite consulta y oculta confirmación', () => {
  const props = { record: { ...record, technicianIds: ['other'] }, serviceDate: record.date, canManage: true, onSave: noop, close: noop, onSaved: noop }
  const html = render('src/components/Collections.jsx', 'CollectionEditor', props,
    userWith('collections.view', 'records.financial', 'collections.confirm', 'scope.services.write.assigned'), 'export { CollectionEditor };')
  assert.match(html, /Detalle de cobranza/)
  assert.doesNotMatch(html, /Confirmar pago|Guardar corrección/)
})

test('menú principal conserva indicadores sin exportar ni abrir datos detallados', () => {
  const html = render('src/features/dashboard/presentation/Dashboard.jsx', 'default', { history: [record], services: [service] }, userWith('dashboard.view'))
  assert.doesNotMatch(html, />Excel<|>PDF<|>Ver<\/button>/)
  assert.match(html, /Indicadores operativos/)
})

test('roles legados conservan sus controles previos sin provider', () => {
  const html = render('src/features/services/presentation/ServiceTypes.jsx', 'default', { services: [service], setServices: noop, setNotice: noop, ask: noop })
  assert.match(html, /Nuevo servicio/)
  assert.match(html, /aria-label="Eliminar Servicio QA"/)
  const accounts = render('src/features/customers/presentation/Accounts.jsx', 'Accounts', { customers: [], history: [], services: [], teams: [], weekly: {}, setCustomers: noop, setNotice: noop, ask: noop })
  assert.doesNotMatch(accounts, /Nuevo cliente|Importar abonados|Deshacer última importación/)
  assert.equal(policy.isGranular({ permissions: {} }), false)
})
