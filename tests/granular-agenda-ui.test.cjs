const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { buildSync } = require('esbuild')

let fields, components
test.before(async () => {
  fields = await import('../src/features/agenda/application/planning-permissions.mjs')
  const root = path.resolve(__dirname, '..')
  const contents = `
    export { PermissionsProvider } from './src/presentation/contexts/permissions-context.jsx'
    export { InternalPreparationFields, ServiceExtraFields, CustomerAutocomplete, ServiceConfirmationButton } from './src/features/agenda/presentation/AgendaFields.jsx'
    export { default as ServicePreparationButton } from './src/components/ServicePreparationButton.jsx'
    export { TechnicianPortal } from './src/features/technicians/presentation/TechnicianPortal.jsx'
    export { AgendaWorkspaceForm } from './src/features/agenda/presentation/DailyAgenda.jsx'
    export { WeeklyPlanner } from './src/features/agenda/presentation/WeeklyPlanner.jsx'
  `
  const built = buildSync({ stdin: { contents, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'test-permissions-ui.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(built.outputFiles[0].text, compiled.id)
  components = compiled.exports
})
const noop = () => {}
const allow = (...ids) => id => ids.includes(id)
function user(ids, extra = {}) {
  return { id: 'tech', roleCode: 'user', name: 'Usuario', permissions: { __catalogV2: true, ...Object.fromEntries(ids.map(id => [id, true])) }, ...extra }
}
const planning = ['weekly.view', 'agenda.view', 'records.read']
function render(name, ids, props, extra) {
  return renderToStaticMarkup(React.createElement(components.PermissionsProvider, { user: user(ids, extra) },
    React.createElement(components[name], props)))
}

test('general editing does not authorize independent notes, account, checklist, financial or confirmation patches', () => {
  const patch = { detail: 'Detalle nuevo', estimatedMinutes: 90, internalNote: 'Privada', internalChecklist: [], customerId: 'other', amount: '200', frozenMonths: 4, awaitingConfirmation: false }
  assert.deepEqual(fields.permittedPlanningPatch(patch, { can: allow('planning.edit'), existing: true }), { detail: 'Detalle nuevo', estimatedMinutes: 90 })
  assert.deepEqual(fields.permittedPlanningPatch(patch, { can: allow('planning.notes'), existing: true }), { internalNote: 'Privada' })
  assert.equal(fields.canSavePlanningFields(allow('planning.notes'), true), true)
  assert.equal(fields.canSavePlanningFields(allow('planning.notes'), false), false)
  assert.deepEqual(fields.permittedPlanningPatch({ time: '10:00' }, { can: allow('planning.edit'), existing: true }), {})
  assert.deepEqual(fields.permittedPlanningPatch({ time: '10:00' }, { can: allow('planning.edit', 'planning.reschedule'), existing: true }), { time: '10:00' })
  assert.deepEqual(fields.permittedPlanningPatch({ time: '10:00' }, { can: allow('planning.create'), existing: false }), { time: '10:00' })
  const training = { client: 'Capacitación cerco', address: 'Centro', phone: '123' }
  assert.deepEqual(fields.permittedPlanningPatch(training, { can: allow('planning.edit'), existing: true, action: 'planning.training' }), training)
  assert.deepEqual(fields.permittedPlanningPatch(training, { can: allow('planning.notes'), existing: true, action: 'planning.training' }), {})
})

test('reservations and creating customers do not grant broader editing or arbitrary linking', () => {
  const patch = { client: 'Reserva', customerId: '', subscriberReservation: true, amount: '500', detail: 'Otro detalle' }
  assert.deepEqual(fields.permittedPlanningPatch(patch, { can: allow('planning.reservation.create'), existing: true, action: 'planning.reservation.create' }),
    { client: 'Reserva', customerId: '', subscriberReservation: true })
  assert.deepEqual(fields.permittedPlanningPatch({ customerId: 'other' }, { can: allow('customers.create'), existing: true, action: 'customers.create' }), {})
  assert.deepEqual(fields.permittedPlanningPatch({ customerId: 'pig' }, { can: allow('planning.linkAccount'), existing: true, task: { subscriberReservation: true } }), {})
})

test('copying omits contact and financial fields without mutating the service', () => {
  const record = { id: 'r', client: 'Cliente', detail: 'Trabajo', address: 'Privada', phone: '123', amount: '500', paymentMethod: 'Efectivo', monthlyFee: '100', formEmail: 'private@test' }
  assert.deepEqual(fields.serviceCopyRecord(record, allow('planning.copy')), { id: 'r', client: 'Cliente', detail: 'Trabajo' })
  assert.equal(record.amount, '500')
  assert.equal(fields.serviceCopyRecord(record, allow('records.contact')).phone, '123')
})

test('ready and confirmation controls require their independent permissions, including configurable operator roles', () => {
  const record = { id: 'r', status: 'Pendiente', client: 'Cliente', technicianIds: ['tech'] }
  assert.equal(render('ServicePreparationButton', planning, { record }), '')
  assert.match(render('ServicePreparationButton', [...planning, 'planning.ready'], { record }, { roleCode: 'operator' }), /service-preparation-button/)
  assert.equal(render('ServiceConfirmationButton', planning, { task: record, day: '2099-01-05', onDraftChange: noop }), '')
  assert.match(render('ServiceConfirmationButton', [...planning, 'planning.confirm'], { task: record, day: '2099-01-05', onDraftChange: noop }), /Servicio a confirmar/)
  assert.equal(render('ServicePreparationButton', [...planning, 'planning.ready', 'scope.services.write.assigned'], { record: { ...record, technicianIds: ['other'] } }), '')
})

test('notes and checklist stay independently editable and commercial fields require financial read', () => {
  const task = { internalNote: 'Preparación', internalChecklist: [{ id: 'check', text: 'Cable', completed: false }] }
  const notes = render('InternalPreparationFields', [...planning, 'planning.notes'], { task, onChange: noop })
  assert.match(notes, /<textarea[^>]*>Preparación/)
  assert.doesNotMatch(notes, /<textarea[^>]*readonly/)
  assert.match(notes, /<input[^>]*disabled=""[^>]*type="checkbox"/)
  const checklist = render('InternalPreparationFields', [...planning, 'planning.checklist'], { task, onChange: noop })
  assert.match(checklist, /<textarea[^>]*readonly=""/)
  assert.doesNotMatch(checklist, /<input[^>]*disabled=""[^>]*type="checkbox"/)
  const commercial = render('ServiceExtraFields', [...planning, 'planning.edit'], { task: { ...task, amount: '999', paymentMethod: 'Efectivo' }, service: { name: 'Servicio técnico' }, onChange: noop })
  assert.doesNotMatch(commercial, /999|Forma de pago|Abono mensual/)
})

test('technical completion is independent of start, cancellation and rescheduling permissions', () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const record = { id: 'r', date: today, time: '00:00', status: 'Pendiente', client: 'Cliente', service: 'Servicio técnico', technicianIds: ['tech'], startedAt: '2020-01-01T12:00:00Z', detail: 'Trabajo', paymentMethod: 'Efectivo', amount: '12345' }
  const ids = ['technical.view', 'records.read', 'technical.complete']
  const markup = render('TechnicianPortal', ids, { user: user(ids), history: [record], setHistory: noop, logout: noop })
  assert.match(markup, /Marcar completado/)
  assert.doesNotMatch(markup, /Solicitar reprogramación|Informar cancelación|Ver historial del cliente/)
  const withoutReport = render('TechnicianPortal', ['technical.view', 'records.read', 'technical.start'], { user: user(ids), history: [record], setHistory: noop, logout: noop })
  assert.doesNotMatch(withoutReport, /Marcar completado|Solicitar reprogramación|Informar cancelación/)
  assert.doesNotMatch(markup, /Forma de pago/)
  const financial = render('TechnicianPortal', [...ids, 'records.financial'], { user: user(ids), history: [record], setHistory: noop, logout: noop })
  assert.match(financial, /Forma de pago/)
  assert.match(financial, /12.345/)
})
