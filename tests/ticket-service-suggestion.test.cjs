const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const domain = require('../api/_lib/tickets.cjs')
const suggestions = require('../api/_lib/ticket-service-suggestion.cjs')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const admin = { id: 'admin', name: 'Soporte', roleCode: 'administrator' }
const service = (id, name, extra = {}) => ({ id, name, code: `service-${id}`, status: 'Activo', estimatedMinutes: 60, ...extra })
const catalog = () => [
  service('alarm-maintenance', 'Service de alarma'),
  service('camera-maintenance', 'Service de cámaras'),
  service('camera-installation', 'Instalación de cámaras'),
  service('fence-maintenance', 'Service de cerco eléctrico'),
  service('totem-maintenance', 'Service de tótem'),
  service('retired', 'Service de cámaras', { status: 'Inactivo' }),
  service('vehicle', 'Control semanal de vehículo'),
  service('training', 'Capacitación'),
  service('meeting', 'Reunión Mensual'),
  service('system', 'Servicio interno renombrado', { system: true })
]
const command = (action, extra = {}) => ({ action, commandId: crypto.randomUUID(), ...extra })
const stateFor = () => ({ services: catalog(), customers: [{ customerId: 'customer', account: 'PIG-10', name: 'Cliente' }], history: [], employees: [], roles: [] })

test('Servicio sugerido: sólo tipos activos de atención, datos públicos y herencia con exclusión explícita', () => {
  const state = stateFor(), config = domain.defaultConfig()
  assert.deepEqual(suggestions.serviceOptions(state).map(item => item.id).sort(), ['alarm-maintenance', 'camera-installation', 'camera-maintenance', 'fence-maintenance', 'totem-maintenance'])
  assert.deepEqual(Object.keys(suggestions.serviceOptions(state)[0]).sort(), ['code', 'id', 'name'])
  for (const extra of [{ code: 'vehicle-weekly-control' }, { category: 'training' }, { category: 'monthly-meeting' }, { vehicleControl: true }, { status: undefined }]) assert.equal(suggestions.eligibleService(service('x', 'Renombrado', extra)), false)
  const category = config.categories.find(item => item.id === 'cameras')
  category.defaultServiceId = 'camera-maintenance'
  const ticket = { categoryId: category.id, subcategoryId: 'no-image' }
  assert.equal(suggestions.suggestedServiceId(ticket, config, state), 'camera-maintenance')
  category.subcategories[0].defaultServiceId = ''
  assert.equal(suggestions.suggestedServiceId(ticket, config, state), '')
  category.subcategories[0].defaultServiceId = 'camera-installation'
  assert.equal(suggestions.suggestedServiceId(ticket, config, state), 'camera-installation')
  state.services.find(item => item.id === 'camera-installation').status = 'Inactivo'
  assert.equal(suggestions.suggestedServiceId(ticket, config, state), '')
  category.subcategories[0].active = false
  assert.equal(suggestions.suggestedServiceId(ticket, config, state), '')
})

test('Servicio sugerido: validación rechaza nuevas referencias inválidas y conserva una referencia retirada al editar otro campo', () => {
  const state = stateFor(), original = domain.defaultConfig(), input = structuredClone(original)
  const camera = input.categories.find(item => item.id === 'cameras')
  camera.defaultServiceId = 'camera-maintenance'
  camera.subcategories[0].defaultServiceId = ''
  const validated = domain.validateConfig(input, state, original)
  assert.equal(domain.classification(validated, 'cameras', 'no-image').effective.defaultServiceId, '')
  assert.equal(domain.classification(validated, 'cameras', 'recording').effective.defaultServiceId, 'camera-maintenance')
  for (const invalid of ['not-exists', 'retired', 'vehicle', 'training', 'meeting', 'system']) {
    camera.defaultServiceId = invalid
    assert.throws(() => domain.validateConfig(input, state, original), /tipo de servicio activo/)
  }
  const next = structuredClone(validated)
  next.categories.find(item => item.id === 'cameras').priority = 'Alta'
  state.services = []
  assert.equal(domain.validateConfig(next, state, validated).categories.find(item => item.id === 'cameras').defaultServiceId, 'camera-maintenance')
  next.categories.find(item => item.id === 'cameras').defaultServiceId = 123
  assert.throws(() => domain.validateConfig(next, state, validated), /formato inválido/)
})

test('Servicio sugerido: inicialización aditiva conserva nombres, IDs, reglas y exclusiones personalizadas', () => {
  const config = domain.defaultConfig()
  config.categories = config.categories.filter(item => !['cameras', 'electric-fence', 'totems'].includes(item.id))
  config.categories.find(item => item.id === 'alarm').defaultServiceId = 'camera-installation'
  config.categories.push({ id: 'our-cctv', name: 'CCTV', active: true, priority: 'Baja', defaultServiceId: '', subcategories: [] })
  config.categories.push({ id: 'electric-fence', name: 'Mis impresoras', active: true, subcategories: [] })
  const previous = structuredClone(config)
  const next = suggestions.initializeServiceDefaults(config, stateFor(), domain.defaultConfig())
  assert.deepEqual(config, previous)
  assert.equal(next.categories.filter(item => /cctv|cámara/i.test(item.name)).length, 1)
  assert.deepEqual(next.categories.find(item => item.id === 'our-cctv'), previous.categories.find(item => item.id === 'our-cctv'))
  assert.deepEqual(next.categories.find(item => item.id === 'electric-fence'), previous.categories.find(item => item.id === 'electric-fence'))
  assert.equal(next.categories.find(item => item.id === 'alarm').defaultServiceId, 'camera-installation')
  assert.equal(next.categories.find(item => item.id === 'totems').defaultServiceId, 'totem-maintenance')
  assert.deepEqual(suggestions.initializeServiceDefaults(next, stateFor(), domain.defaultConfig()), next)
})

test('Servicio sugerido: códigos estables prevalecen, nombres exactos son respaldo y coincidencias ambiguas no adivinan', () => {
  const config = domain.defaultConfig()
  let state = { services: [service('c1', 'Mantenimiento video renombrado', { code: 'camera-service' }), service('c2', 'Service de cámaras'), service('x', 'Instalación de alarma')] }
  assert.equal(suggestions.initializeServiceDefaults(config, state, config).categories.find(item => item.id === 'cameras').defaultServiceId, 'c1')
  assert.equal(suggestions.initializeServiceDefaults(config, state, config).categories.find(item => item.id === 'alarm').defaultServiceId, '')
  state = { services: [service('c1', 'Service de cámaras'), service('c2', 'Service de cámaras')] }
  assert.equal(suggestions.initializeServiceDefaults(config, state, config).categories.find(item => item.id === 'cameras').defaultServiceId, '')
})

async function fixture(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:')
    const q = async (query, args = []) => /^SELECT/i.test(query) ? db.prepare(query).all(...args) : db.prepare(query).run(...args)
    return { store: createTicketStore({ db }), q, restart: () => createTicketStore({ db }), close: () => db.close() }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create(), sql = pgliteAdapter(pg)
  return { store: createTicketStore({ sql }), q: async (query, args = []) => { let n = 0; return (await pg.query(query.replace(/\?/g, () => `$${++n}`), args)).rows }, restart: () => createTicketStore({ sql }), close: () => pg.close() }
}

for (const engine of ['sqlite', 'postgres']) test(`Servicio sugerido ${engine}: migración versionada y sugerencia actual sin reescribir tickets`, async () => {
  const env = await fixture(engine), { store, q } = env, state = stateFor()
  try {
    await store.ensure()
    const previous = domain.defaultConfig()
    previous.categories = previous.categories.filter(item => !['cameras', 'electric-fence', 'totems'].includes(item.id))
    previous.categories.find(item => item.id === 'alarm').priority = 'Crítica'
    await q('UPDATE pignus_ticket_settings SET data=? WHERE id=?', [JSON.stringify({ version: 7, nextNumber: 1000001, config: previous }), 'config'])
    const withoutCatalog = { ...state }; delete withoutCatalog.services
    const oldTicket = (await store.run(admin, withoutCatalog, command('create', { categoryId: 'alarm', customerId: 'customer', description: 'Consulta anterior', origin: 'internal' }))).ticket
    const oldRaw = (await q('SELECT data FROM pignus_tickets WHERE id=?', [oldTicket.id]))[0].data
    const metadata = await store.query(admin, state, { mode: 'metadata' })
    assert.equal(metadata.configVersion, 8)
    assert.equal(metadata.config.categories.find(item => item.id === 'alarm').priority, 'Crítica')
    assert.equal(metadata.config.categories.find(item => item.id === 'cameras').defaultServiceId, 'camera-maintenance')
    assert.equal(metadata.config.categories.find(item => item.id === 'electric-fence').defaultServiceId, 'fence-maintenance')
    assert.equal((await q('SELECT data FROM pignus_tickets WHERE id=?', [oldTicket.id]))[0].data, oldRaw)
    assert.equal((await store.query(admin, state, { mode: 'detail', id: oldTicket.id })).ticket.suggestedServiceId, 'alarm-maintenance')
    assert.equal(metadata.services.some(item => item.id === 'vehicle'), false)
    const duplicates = await store.query(admin, state, { mode: 'duplicates', customerId: 'customer' })
    const created = (await store.run(admin, state, command('create', { categoryId: 'cameras', subcategoryId: 'no-image', customerId: 'customer', description: 'La cámara no muestra imagen', origin: 'internal', allowDuplicate: true, duplicateToken: duplicates.duplicateToken }))).ticket
    assert.equal(created.suggestedServiceId, 'camera-maintenance')
    assert.equal(JSON.parse((await q('SELECT data FROM pignus_tickets WHERE id=?', [created.id]))[0].data).suggestedServiceId, undefined)
    const next = structuredClone(metadata.config)
    next.categories.find(item => item.id === 'cameras').subcategories.find(item => item.id === 'no-image').defaultServiceId = ''
    const configured = await store.run(admin, state, command('configure', { config: next, version: metadata.configVersion }))
    assert.equal((await store.query(admin, state, { mode: 'detail', id: created.id })).ticket.suggestedServiceId, '')
    const updated = structuredClone(configured.config)
    updated.categories.find(item => item.id === 'cameras').subcategories.find(item => item.id === 'no-image').defaultServiceId = 'camera-installation'
    const configuredAgain = await store.run(admin, state, command('configure', { config: updated, version: configured.configVersion }))
    assert.equal((await store.query(admin, state, { mode: 'detail', id: created.id })).ticket.suggestedServiceId, 'camera-installation')
    const inactive = structuredClone(state)
    inactive.services.find(item => item.id === 'camera-installation').status = 'Inactivo'
    assert.equal((await store.query(admin, inactive, { mode: 'detail', id: created.id })).ticket.suggestedServiceId, '')
    const restarted = env.restart()
    assert.equal((await restarted.query(admin, state, { mode: 'metadata' })).configVersion, configuredAgain.configVersion)
    assert.equal((await q('SELECT id FROM pignus_ticket_settings WHERE id=?', ['ticket-service-defaults-v1'])).length, 1)
  } finally { await env.close() }
})
