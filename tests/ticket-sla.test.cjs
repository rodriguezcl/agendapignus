const test = require('node:test')
const assert = require('node:assert/strict')
const sla = require('../api/_lib/ticket-sla.cjs')
const domain = require('../api/_lib/tickets.cjs')
const NOW = '2026-10-23T10:00:00.000Z'
const later = minutes => new Date(new Date(NOW).getTime() + minutes * 60000).toISOString()
const clone = value => JSON.parse(JSON.stringify(value))
const config = () => ({ sla: sla.defaultSlaConfig() })
const ticket = (patch = {}) => ({ id: 'case-1', priority: 'Alta', status: 'Nuevo', createdAt: NOW, createdById: 'operator', requesterId: 'operator', ...patch })
const move = (value, action, patch = {}, minutes = 0, options = {}) => {
  const previous = clone(value)
  Object.assign(value, patch)
  sla.transitionSla(value, previous, action, config(), later(minutes), options)
  return value
}

test('SLA: valores iniciales explícitos y validación de plazos', () => {
  const defaults = sla.defaultSlaConfig()
  assert.deepEqual(defaults.priorities.Crítica, { firstResponseMinutes: 15, resolutionMinutes: 240, updateMinutes: 60 })
  assert.deepEqual(defaults.priorities.Alta, { firstResponseMinutes: 60, resolutionMinutes: 1440, updateMinutes: 240 })
  assert.deepEqual(defaults.priorities.Media, { firstResponseMinutes: 240, resolutionMinutes: 4320, updateMinutes: 1440 })
  assert.deepEqual(defaults.priorities.Baja, { firstResponseMinutes: 480, resolutionMinutes: 7200, updateMinutes: 2880 })
  assert.equal(defaults.clock, 'elapsed')
  for (const value of [0, -1, 0.5, NaN, Infinity, '60', 525601, null]) {
    const invalid = clone(defaults)
    invalid.priorities.Alta.resolutionMinutes = value
    assert.throws(() => sla.validateSlaConfig(invalid), error => error.statusCode === 400)
  }
  assert.throws(() => sla.validateSlaConfig({ ...defaults, clock: 'business' }), /horas corridas/)
  const missing = clone(defaults); delete missing.priorities.Media
  assert.throws(() => sla.validateSlaConfig(missing), /Falta definir/)
  for (const key of ['firstResponseMinutes', 'updateMinutes']) {
    const inconsistent = clone(defaults); inconsistent.priorities.Alta[key] = 1441
    assert.throws(() => sla.validateSlaConfig(inconsistent), /no pueden superar/)
  }
  const minimum = clone(defaults); minimum.priorities.Crítica = { firstResponseMinutes: 1, resolutionMinutes: 1, updateMinutes: 1 }
  assert.equal(sla.validateSlaConfig(minimum).priorities.Crítica.resolutionMinutes, 1)
})

test('SLA: configuración anterior conserva compatibilidad y no borra una política guardada', () => {
  const previous = domain.defaultConfig()
  previous.sla.priorities.Baja.resolutionMinutes = 14400
  const oldClient = clone(previous); delete oldClient.sla
  assert.equal(domain.validateConfig(oldClient, { employees: [] }, previous).sla.priorities.Baja.resolutionMinutes, 14400)
  assert.deepEqual(domain.validateConfig(oldClient, { employees: [] }, oldClient).sla, sla.defaultSlaConfig())
})

test('SLA: el reloj incluye noches y fines de semana y espera no lo pausa', () => {
  const item = ticket()
  sla.initSla(item, config(), NOW)
  assert.equal(item.sla.firstResponseDueAt, later(60))
  assert.equal(item.sla.resolutionDueAt, '2026-10-24T10:00:00.000Z')
  move(item, 'wait', { status: 'En espera' }, 120, { humanUpdate: true, actorId: 'support' })
  assert.equal(item.sla.resolutionDueAt, later(1440))
  assert.equal(item.sla.firstResponseAt, later(120))
  assert.equal(sla.slaView(item, later(1441)).resolution.status, 'overdue')
  move(item, 'resume', { status: 'En gestión' }, 1500)
  assert.equal(item.sla.startedAt, NOW)
  assert.equal(item.sla.resolutionDueAt, later(1440))
})

test('SLA: el ticket congela la política y reclasificar no reinicia su fecha de inicio', () => {
  const settings = config(), item = ticket()
  sla.initSla(item, settings, NOW)
  settings.sla.priorities.Crítica.resolutionMinutes = 600
  const previous = clone(item); item.priority = 'Crítica'
  sla.transitionSla(item, previous, 'classify', settings, later(180))
  assert.equal(item.sla.resolutionDueAt, later(240))
  assert.equal(item.sla.firstResponseDueAt, later(15))
  assert.equal(item.sla.startedAt, NOW)
  assert.equal(sla.slaView(item, later(241)).resolution.breached, true)
  move(item, 'assign', { assigneeId: 'support' }, 300, { humanUpdate: true, actorId: 'admin' })
  assert.equal(item.sla.resolutionDueAt, later(240))
})

test('SLA: recibir un mensaje o emitir un acuse automático no cuenta como respuesta humana', () => {
  const item = ticket()
  sla.initSla(item, config(), NOW)
  move(item, 'acknowledge', {}, 5, { humanUpdate: true, actorId: 'system' })
  move(item, 'comment', {}, 10, { humanUpdate: true, actorId: 'operator' })
  move(item, 'comment', {}, 15)
  assert.equal(item.sla.firstResponseAt, '')
  assert.equal(item.sla.updateDueAt, later(240))
  move(item, 'reply', {}, 20, { humanUpdate: true, actorId: 'support' })
  assert.equal(item.sla.firstResponseAt, later(20))
  assert.equal(item.sla.lastHumanUpdateAt, later(20))
  assert.equal(item.sla.updateDueAt, later(260))
  move(item, 'reply', {}, 30, { humanUpdate: true, actorId: 'support' })
  assert.equal(item.sla.firstResponseAt, later(20))
  assert.equal(item.sla.updateDueAt, later(270))
})

test('SLA: adopción de casos existentes comienza ahora, sin marcar mora retroactiva', () => {
  const old = ticket({ createdAt: '2025-01-01T00:00:00.000Z' })
  assert.equal(sla.slaView(old, NOW).status, 'not-started')
  sla.initSla(old, config(), NOW)
  assert.equal(old.sla.adoptedAt, NOW)
  assert.equal(old.sla.startedAt, NOW)
  assert.equal(old.sla.resolutionDueAt, later(1440))
  assert.equal(sla.slaView(old, NOW).status, 'on-track')
  const closed = ticket({ createdAt: '2025-01-01T00:00:00.000Z', status: 'Resuelto' })
  sla.initSla(closed, config(), NOW)
  assert.equal(sla.slaView(closed, NOW).status, 'excluded')
  assert.deepEqual(sla.dueReminders(closed, later(10000)), [])
  const closing = ticket({ createdAt: '2025-01-01T00:00:00.000Z' })
  move(closing, 'resolve', { status: 'Resuelto' }, 0, { humanUpdate: true, actorId: 'support' })
  assert.equal(closing.sla.excluded, false)
})

test('SLA: una reapertura conserva el resultado anterior y empieza un nuevo ciclo con la política original', () => {
  const item = ticket()
  sla.initSla(item, config(), NOW)
  move(item, 'resolve', { status: 'Resuelto', resolvedAt: later(1500) }, 1500, { humanUpdate: true, actorId: 'support' })
  const closed = sla.slaView(item, later(2000))
  assert.equal(closed.status, 'closed')
  assert.equal(closed.resolution.status, 'late')
  assert.equal(closed.resolution.remainingMinutes, -60)
  const settings = config(); settings.sla.priorities.Alta.resolutionMinutes = 3000
  const previous = clone(item); item.status = 'En gestión'
  sla.transitionSla(item, previous, 'reopen', settings, later(2000))
  assert.equal(item.sla.cycle, 2)
  assert.equal(item.sla.startedAt, later(2000))
  assert.equal(item.sla.resolutionDueAt, later(3440))
  assert.equal(item.sla.firstResponseAt, '')
  assert.equal(item.sla.history.length, 1)
  assert.equal(item.sla.history[0].completedAt, later(1500))
  assert.equal(item.sla.history[0].resolutionDueAt, later(1440))
  move(item, 'resume', {}, 2010)
  assert.equal(item.sla.cycle, 2)
  assert.equal(item.sla.history.length, 1)
})

test('SLA: recordatorios tienen claves estables y solo una gestión real renueva el intervalo', () => {
  const item = ticket({ priority: 'Crítica' })
  sla.initSla(item, config(), NOW)
  assert.deepEqual(sla.dueReminders(item, later(14)), [])
  assert.deepEqual(sla.dueReminders(item, later(15)).map(value => value.type), ['first-response'])
  const overdue = sla.dueReminders(item, later(241))
  assert.deepEqual(overdue.map(value => value.type), ['first-response', 'resolution', 'update'])
  assert.deepEqual(overdue, sla.dueReminders(item, later(300)))
  move(item, 'scheduleService', { status: 'En gestión' }, 300, { humanUpdate: true, actorId: 'support' })
  assert.equal(item.sla.resolutionDueAt, later(240))
  assert.deepEqual(sla.dueReminders(item, later(301)).map(value => value.type), ['resolution'])
  const nextUpdate = sla.dueReminders(item, later(361)).find(value => value.type === 'update')
  assert.notEqual(nextUpdate.key, overdue.find(value => value.type === 'update').key)
  move(item, 'merge', { status: 'Fusionado' }, 400)
  assert.deepEqual(sla.dueReminders(item, later(500)), [])
})

test('SLA: los nuevos tickets reciben plazos y la presentación expone su resumen', () => {
  const item = domain.newTicket({ origin: 'internal', categoryId: 'internal', subcategoryId: 'printing', description: 'La impresora no funciona.' }, { id: 'admin', name: 'Administrador', roleCode: 'administrator' }, { customers: [], history: [] }, domain.defaultConfig(), 1000001, NOW)
  assert.equal(item.sla.startedAt, NOW)
  assert.equal(item.sla.resolutionDueAt, later(4320))
  const presented = domain.present(item, { id: 'admin', roleCode: 'administrator' })
  assert.equal(presented.slaSummary.cycle, 1)
  assert.equal(presented.slaSummary.resolution.dueAt, later(4320))
})

test('SLA: cerrar o fusionar sin respuesta humana no inventa una primera respuesta', () => {
  const item = ticket()
  sla.initSla(item, config(), NOW)
  move(item, 'merge', { status: 'Fusionado' }, 120)
  const summary = sla.slaView(item, later(300))
  assert.equal(summary.status, 'closed')
  assert.equal(summary.firstResponse.status, 'unanswered')
  assert.equal(summary.firstResponse.completedAt, '')
})

test('SLA: un caso por correo cerrado sigue esperando la entrega real de su primera respuesta', () => {
  const item = ticket({ origin: 'email', createdById: 'email', requesterId: '' })
  sla.initSla(item, config(), NOW)
  move(item, 'resolve', { status: 'Resuelto' }, 30)
  let summary = sla.slaView(item, later(40))
  assert.equal(summary.status, 'closed')
  assert.equal(summary.resolution.status, 'met')
  assert.equal(summary.firstResponse.status, 'pending')
  assert.equal(summary.firstResponse.completedAt, '')
  summary = sla.slaView(item, later(70))
  assert.equal(summary.firstResponse.status, 'overdue')
  assert.equal(summary.firstResponse.remainingMinutes, -10)
  move(item, 'reply', {}, 80, { humanUpdate: true, actorId: 'support' })
  summary = sla.slaView(item, later(100))
  assert.equal(summary.firstResponse.completedAt, later(80))
  assert.equal(summary.firstResponse.status, 'late')
  assert.equal(summary.resolution.completedAt, later(30))
})

test('SLA: entregas fuera de orden conservan primera respuesta más temprana y última actualización más reciente', () => {
  const item = ticket({ origin: 'email', createdById: 'email', requesterId: '' })
  sla.initSla(item, config(), NOW)
  move(item, 'reply', {}, 20, { humanUpdate: true, actorId: 'support' })
  move(item, 'reply', {}, 10, { humanUpdate: true, actorId: 'support' })
  assert.equal(item.sla.firstResponseAt, later(10))
  assert.equal(item.sla.lastHumanUpdateAt, later(20))
  assert.equal(item.sla.updateDueAt, later(260))
  move(item, 'reply', {}, -10, { humanUpdate: true, actorId: 'support' })
  assert.equal(item.sla.firstResponseAt, later(10))
  assert.equal(item.sla.lastHumanUpdateAt, later(20))
})
