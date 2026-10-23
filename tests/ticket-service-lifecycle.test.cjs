const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { resolutionEvidence } = require('../api/_lib/ticket-service-lifecycle.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')

const operator = { id: 'operator', name: 'Operadora', roleCode: 'administrator' }
const support = { id: 'support', name: 'Soporte', roleCode: 'administrator' }
const technician = { id: 'technician', name: 'Técnico', roleCode: 'administrator' }
const at = '2026-10-23T15:00:00.000Z'
const cmd = (action, fields = {}) => ({ commandId: crypto.randomUUID(), action, ...fields })
const clone = value => structuredClone(value)

async function fixture(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys=ON')
    const store = createTicketStore({ db }); await store.ensure()
    return { store, query: async (sql, args = []) => /\bSELECT\b|\bRETURNING\b/.test(sql) ? db.prepare(sql).all(...args) : (db.prepare(sql).run(...args), []), close: () => db.close() }
  }
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  const store = createTicketStore({ sql: pgliteAdapter(pg) }); await store.ensure()
  return { store, query: async (sql, args = []) => (await pg.query(sqlParameters(sql), args)).rows, close: () => pg.close() }
}

async function createCase(f, name) {
  const state = { roles: [{ id: 'admin-role', code: 'administrator', name: 'Administrador', permissions: {} }],
    employees: [operator, support, technician].map(user => ({ ...user, roleId: 'admin-role', status: 'Activo' })),
    customers: [{ customerId: name, account: `PIG-${name}`, name: `Cuenta ${name}` }, { customerId: 'other', account: 'PIG-other', name: 'Otra cuenta' }], history: [] }
  const ticket = (await f.store.run(operator, state, cmd('create', { title: `Reclamo ${name}`, description: 'La cámara no muestra imagen.',
    categoryId: 'alarm', subcategoryId: 'repeated', customerId: name, origin: 'phone' }))).ticket
  const record = { id: `service-${name}`, customerId: name, client: `Cuenta ${name}`, clientAccount: `PIG-${name}`, service: 'Service de cámaras',
    date: '2026-10-24', time: '09:30', teamId: 'team-1', technicianIds: [technician.id], status: 'Pendiente', sourceTicketId: ticket.id, ticketNumber: ticket.number,
    detail: `Revisar imagen. Ticket#${ticket.number}` }
  const detail = async (user = support) => (await f.store.query(user, state, { mode: 'detail', id: ticket.id })).ticket
  const notices = async (user = operator) => (await f.store.query(user, state, { mode: 'notifications' })).notifications.filter(item => item.target.ticketId === ticket.id && item.notificationId)
  return { state, ticket, record, detail, notices }
}

const completed = (record, options = {}) => {
  const next = { ...record, status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Se corrigió la conexión y se verificó la imagen.', ...options }
  next.ticketResolution = resolutionEvidence({ resolved: options.resolved !== false, ticketIds: options.ticketIds || (record.sourceTicketId ? [record.sourceTicketId] : undefined) }, next, technician, options.at || at, next.followup)
  return next
}

test('la evidencia usa autor, fecha y texto del informe del servidor y exige tickets explícitos para vínculos manuales', () => {
  const record = { technicalStatus: 'Completado', technicalObservation: 'Se verificó el panel.' }
  assert.throws(() => resolutionEvidence({ resolved: true }, record, technician, at), /tickets asociados/)
  const result = resolutionEvidence({ resolved: true, ticketIds: ['ticket-1'], at: '2000-01-01', byId: 'fake', report: 'Informe falso' }, record, technician, at)
  assert.equal(result.byId, technician.id)
  assert.equal(result.at, at)
  assert.equal(result.report, record.technicalObservation)
  assert.deepEqual(result.ticketIds, ['ticket-1'])
  assert.throws(() => resolutionEvidence({ resolved: true, ticketIds: ['ticket-1'] }, { ...record, technicalStatus: 'Pendiente' }, technician, at), /informe técnico completado/)
})

for (const engine of ['sqlite', 'postgres']) test(`Tickets y Agenda ${engine}: vínculo, resolución y SLA transaccionales`, async t => {
  const f = await fixture(engine)
  try {
    await t.test('agendar crea vínculo duradero y aviso; repetir la misma escritura no duplica ni altera plazos', async () => {
      const c = await createCase(f, 'scheduled'), next = { ...c.state, history: [c.record] }
      await f.store.syncServices(c.state, next, { user: support, now: at })
      const saved = await c.detail()
      assert.equal(saved.status, 'En gestión')
      assert.deepEqual(saved.serviceIds, [c.record.id])
      assert.deepEqual(saved.resolutionServiceIds, [c.record.id])
      assert.equal(saved.sla.firstResponseAt, at)
      assert.equal(saved.sla.lastHumanUpdateAt, at)
      assert.ok(saved.events.some(entry => entry.action === 'automatic-scheduled' && entry.body.includes('09:30')))
      const before = await c.notices()
      await f.store.syncServices(next, clone(next), { user: support, now: '2026-10-23T16:00:00.000Z' })
      assert.equal((await c.detail()).version, saved.version)
      assert.equal((await c.notices()).length, before.length)
    })

    await t.test('una segunda relación con cuenta incorrecta revierte también el primer vínculo y aviso', async () => {
      const c = await createCase(f, 'rollback'), original = await c.detail(), notices = await c.notices()
      const invalid = { ...c.record, id: `${c.record.id}-wrong`, customerId: 'other', clientAccount: 'PIG-other' }
      await assert.rejects(f.store.syncServices(c.state, { ...c.state, history: [c.record, invalid] }, { user: support, now: at }), /cuenta.*coincide/i)
      assert.deepEqual((await c.detail()).serviceIds, [])
      assert.equal((await c.detail()).version, original.version)
      assert.equal((await c.notices()).length, notices.length)
    })

    await t.test('editar agenda no puede quitar el vínculo, cambiar cuenta ni falsificar la resolución técnica', async () => {
      const c = await createCase(f, 'immutable'), previous = { ...c.state, history: [c.record] }
      await f.store.syncServices(c.state, previous, { user: support, now: at })
      const mutations = [
        { ...c.record, sourceTicketId: '' },
        { ...c.record, customerId: 'other', clientAccount: 'PIG-other' },
        { ...c.record, ticketResolution: { resolved: true, at, byId: 'fake' } }
      ]
      for (const mutated of mutations) await assert.rejects(f.store.syncServices(previous, { ...previous, history: [mutated] }, { user: support, now: at }), error => [403, 409].includes(error.statusCode))
      assert.equal((await c.detail()).status, 'En gestión')
    })

    await t.test('sin permiso de vincular no se puede crear un servicio desde un ticket', async () => {
      const c = await createCase(f, 'permissions')
      const limited = { id: 'limited', name: 'Sin permisos', roleCode: 'custom', permissions: { __catalogV2: true, 'tickets.view': true } }
      await assert.rejects(f.store.syncServices(c.state, { ...c.state, history: [c.record] }, { user: limited, now: at }), { statusCode: 403 })
      assert.deepEqual((await c.detail()).serviceIds, [])
    })

    await t.test('la referencia visible exige el número correcto del ticket al coordinar', async () => {
      const c = await createCase(f, 'number')
      for (const ticketNumber of [undefined, '9999999']) await assert.rejects(f.store.syncServices(c.state, { ...c.state, history: [{ ...c.record, ticketNumber }] }, { user: support, now: at }), { statusCode: 409 })
      assert.deepEqual((await c.detail()).serviceIds, [])
    })

    await t.test('reprogramación y cancelación avisan al solicitante y no cierran el reclamo', async () => {
      const c = await createCase(f, 'changes'), initial = { ...c.state, history: [c.record] }
      await f.store.syncServices(c.state, initial, { user: support, now: at })
      const moved = { ...initial, history: [{ ...c.record, date: '2026-10-26', time: '14:00' }] }
      await f.store.syncServices(initial, moved, { user: support, now: '2026-10-23T16:00:00.000Z' })
      const stopped = { ...moved, history: [{ ...moved.history[0], status: 'Cancelado' }] }
      await f.store.syncServices(moved, stopped, { user: support, now: '2026-10-23T17:00:00.000Z' })
      const item = await c.detail(), notices = await c.notices()
      assert.equal(item.status, 'En gestión')
      assert.ok(notices.some(notice => notice.title.includes('reprogramada') && notice.detail.includes('14:00')))
      assert.ok(notices.some(notice => notice.title.includes('cancelada') && notice.detail.includes('sigue abierto')))
      assert.equal(item.sla.completedAt, '')
    })

    await t.test('completar sin confirmación explícita no cierra; confirmarla cierra y deja aviso persistente', async () => {
      const c = await createCase(f, 'resolution'), planned = { ...c.state, history: [c.record] }
      await f.store.syncServices(c.state, planned, { user: support, now: at })
      const reported = { ...planned, history: [{ ...c.record, status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Trabajo finalizado.' }] }
      await f.store.syncServices(planned, reported, { user: technician, reportRecordId: c.record.id, now: at })
      assert.equal((await c.detail()).status, 'En gestión')
      const finished = { ...reported, history: [completed(reported.history[0])] }
      await f.store.syncServices(reported, finished, { user: technician, reportRecordId: c.record.id, now: at })
      const saved = await c.detail()
      assert.equal(saved.status, 'Resuelto')
      assert.equal(saved.resolvedByServiceId, c.record.id)
      assert.equal(saved.resolutionMethod, 'onsite')
      assert.match(saved.resolution, /verificó la imagen/)
      assert.ok(saved.events.some(entry => entry.action === 'automatic-resolved' && entry.body.includes('El equipo técnico confirmó')))
      assert.equal(saved.sla.completedAt, at)
      const notices = await c.notices()
      assert.ok(notices.some(item => item.title.includes('Caso resuelto')))
      await f.store.syncServices(finished, clone(finished), { user: technician, reportRecordId: c.record.id, now: at })
      assert.equal((await c.detail()).version, saved.version)
      assert.equal((await c.notices()).length, notices.length)
    })

    await t.test('seguimiento del mismo reclamo lo mantiene abierto; una solicitud adicional independiente permite cerrar', async () => {
      const same = await createCase(f, 'same'), planned = { ...same.state, history: [same.record] }
      await f.store.syncServices(same.state, planned, { user: support, now: at })
      const followup = { id: 'followup-same', status: 'Pendiente', relation: 'same', description: 'Falta reemplazar un cable.' }
      assert.throws(() => completed(same.record, { followup }), /seguimiento del mismo caso/)
      const pending = { ...planned, history: [completed(same.record, { followup, resolved: false })] }
      await f.store.syncServices(planned, pending, { user: technician, reportRecordId: same.record.id, now: at })
      assert.equal((await same.detail()).status, 'En gestión')
      const separate = await createCase(f, 'separate'), separatePlanned = { ...separate.state, history: [separate.record] }
      await f.store.syncServices(separate.state, separatePlanned, { user: support, now: at })
      const finished = { ...separatePlanned, history: [completed(separate.record, { followup: { id: 'new-quote', status: 'Pendiente', relation: 'different', description: 'Cotizar otra cámara.' } })] }
      await f.store.syncServices(separatePlanned, finished, { user: technician, reportRecordId: separate.record.id, now: at })
      assert.equal((await separate.detail()).status, 'Resuelto')
    })

    await t.test('jornadas y visitas múltiples deben terminar antes del cierre automático', async () => {
      const c = await createCase(f, 'journeys')
      const first = { ...c.record, serviceJourney: { id: 'journey-1', index: 1, total: 2 } }
      const last = { ...c.record, id: `${c.record.id}-2`, date: '2026-10-25', serviceJourney: { id: 'journey-1', index: 2, total: 2 } }
      const planned = { ...c.state, history: [first, last] }
      await f.store.syncServices(c.state, planned, { user: support, now: at })
      assert.deepEqual((await c.detail()).resolutionServiceIds.sort(), [first.id, last.id].sort())
      const lastDone = { ...planned, history: [first, completed(last)] }
      await f.store.syncServices(planned, lastDone, { user: technician, reportRecordId: last.id, now: at })
      assert.equal((await c.detail()).status, 'En gestión')
      const allDone = { ...planned, history: [completed(first, { at: '2026-10-23T17:00:00.000Z' }), lastDone.history[1]] }
      await f.store.syncServices(lastDone, allDone, { user: technician, reportRecordId: first.id, now: '2026-10-23T17:00:00.000Z' })
      assert.equal((await c.detail()).status, 'Resuelto')
      const multiple = await createCase(f, 'multiple'), a = multiple.record, b = { ...multiple.record, id: `${multiple.record.id}-2` }
      const two = { ...multiple.state, history: [a, b] }
      await f.store.syncServices(multiple.state, two, { user: support, now: at })
      await f.store.syncServices(two, { ...two, history: [completed(a), b] }, { user: technician, reportRecordId: a.id, now: at })
      assert.equal((await multiple.detail()).status, 'En gestión')
    })

    await t.test('una segunda visita resuelve el seguimiento del mismo caso sin reescribir el informe anterior', async () => {
      const c = await createCase(f, 'return-visit'), planned = { ...c.state, history: [c.record] }
      await f.store.syncServices(c.state, planned, { user: support, now: at })
      const firstReport = completed(c.record, { resolved: false, followup: { id: 'followup-return', relatedTicketId: c.ticket.id, status: 'Pendiente', relation: 'same', description: 'Reemplazar cable en próxima visita.', createdAt: at } })
      const firstDone = { ...planned, history: [firstReport] }
      await f.store.syncServices(planned, firstDone, { user: technician, reportRecordId: c.record.id, now: at })
      assert.equal((await c.detail()).status, 'En gestión')
      const second = { ...c.record, id: `${c.record.id}-return`, date: '2026-10-26' }, returnScheduled = { ...firstDone, history: [firstReport, second] }
      await f.store.syncServices(firstDone, returnScheduled, { user: support, now: '2026-10-24T12:00:00.000Z' })
      assert.equal((await c.detail()).status, 'En gestión')
      const finished = { ...returnScheduled, history: [firstReport, completed(second, { at: '2026-10-26T13:00:00.000Z' })] }
      await f.store.syncServices(returnScheduled, finished, { user: technician, reportRecordId: second.id, now: '2026-10-26T13:00:00.000Z' })
      assert.equal((await c.detail()).status, 'Resuelto')
      assert.equal(firstReport.ticketResolution.resolved, false)
      assert.equal(firstReport.followup.status, 'Pendiente')
      assert.equal(firstReport.followup.description, 'Reemplazar cable en próxima visita.')
    })

    await t.test('vinculación manual previa también participa del cierre y el origen de un seguimiento no es visita obligatoria', async () => {
      const c = await createCase(f, 'manual'), manual = { ...c.record }; delete manual.sourceTicketId; delete manual.ticketNumber
      const state = { ...c.state, history: [manual] }
      const linked = (await f.store.run(support, state, cmd('linkService', { id: c.ticket.id, version: c.ticket.version, serviceId: manual.id }))).ticket
      assert.deepEqual(linked.resolutionServiceIds, [manual.id])
      await f.store.syncServices(state, { ...state, history: [completed(manual, { ticketIds: [c.ticket.id] })] }, { user: technician, reportRecordId: manual.id, now: at })
      assert.equal((await c.detail()).status, 'Resuelto')
      const origin = await createCase(f, 'origin'), originRecord = { ...origin.record, status: 'Completado' }; delete originRecord.sourceTicketId
      const followupTicket = (await f.store.run(operator, { ...origin.state, history: [originRecord] }, cmd('create', { title: 'Cotización adicional', description: 'Agregar una cámara.', categoryId: 'commercial', subcategoryId: 'quote', origin: 'technical', serviceId: originRecord.id, customerId: 'origin', allowDuplicate: true, duplicateToken: (await f.store.query(operator, origin.state, { mode: 'duplicates', customerId: 'origin' })).duplicateToken }))).ticket
      assert.deepEqual(followupTicket.serviceIds, [originRecord.id])
      assert.deepEqual(followupTicket.resolutionServiceIds || [], [])
    })

    await t.test('un informe sólo resuelve los tickets que el técnico confirmó explícitamente', async () => {
      const c = await createCase(f, 'selected'), state = { ...c.state, history: [c.record] }
      await f.store.syncServices(c.state, state, { user: support, now: at })
      const duplicates = await f.store.query(operator, state, { mode: 'duplicates', customerId: 'selected' })
      let second = (await f.store.run(operator, state, cmd('create', { title: 'Otro reclamo del mismo cliente', description: 'Revisar el grabador además de la cámara.', categoryId: 'alarm', subcategoryId: 'repeated', customerId: 'selected', origin: 'phone', allowDuplicate: true, duplicateToken: duplicates.duplicateToken }))).ticket
      second = (await f.store.run(support, state, cmd('linkService', { id: second.id, version: second.version, serviceId: c.record.id }))).ticket
      const finished = { ...state, history: [completed(c.record, { ticketIds: [c.ticket.id] })] }
      await f.store.syncServices(state, finished, { user: technician, reportRecordId: c.record.id, now: at })
      assert.equal((await c.detail()).status, 'Resuelto')
      assert.equal((await f.store.query(support, state, { mode: 'detail', id: second.id })).ticket.status, 'En gestión')
    })

    await t.test('los enlaces manuales anteriores se adoptan sin convertir un origen técnico en visita obligatoria', async () => {
      const c = await createCase(f, 'legacy-link'), manual = { ...c.record }; delete manual.sourceTicketId; delete manual.ticketNumber
      const state = { ...c.state, history: [manual] }
      const linked = (await f.store.run(support, state, cmd('linkService', { id: c.ticket.id, version: c.ticket.version, serviceId: manual.id }))).ticket
      const legacy = JSON.parse((await f.query('SELECT data FROM pignus_tickets WHERE id=?', [linked.id]))[0].data)
      delete legacy.resolutionServiceIds
      await f.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify(legacy), linked.id])
      await f.store.syncServices(state, { ...state, history: [completed(manual, { ticketIds: [linked.id] })] }, { user: technician, reportRecordId: manual.id, now: at })
      const resolved = await c.detail()
      assert.deepEqual(resolved.resolutionServiceIds, [manual.id])
      assert.equal(resolved.status, 'Resuelto')

      const base = await createCase(f, 'legacy-context'), origin = { ...base.record }; delete origin.sourceTicketId; delete origin.ticketNumber
      const originState = { ...base.state, history: [origin] }
      const duplicates = await f.store.query(operator, originState, { mode: 'duplicates', customerId: 'legacy-context' })
      let request = (await f.store.run(operator, originState, cmd('create', { title: 'Cotización desde visita previa', description: 'El cliente solicita presupuesto.', categoryId: 'commercial', subcategoryId: 'quote', serviceId: origin.id, customerId: 'legacy-context', allowDuplicate: true, duplicateToken: duplicates.duplicateToken }))).ticket
      const changedContext = { ...originState, history: [completed(origin, { ticketIds: [request.id] })] }
      await f.store.syncServices(originState, changedContext, { user: technician, reportRecordId: origin.id, now: at })
      request = (await f.store.query(support, originState, { mode: 'detail', id: request.id })).ticket
      assert.equal(request.status, 'Nuevo')
      assert.deepEqual(request.resolutionServiceIds, [])

      // Simular el formato previo: contexto de origen y visita manual en una sola lista.
      const visit = { ...origin, id: `${origin.id}-new`, date: '2026-10-26' }, visits = { ...changedContext, history: [changedContext.history[0], visit] }
      request = (await f.store.run(support, visits, cmd('linkService', { id: request.id, version: request.version, serviceId: visit.id }))).ticket
      const oldFormat = JSON.parse((await f.query('SELECT data FROM pignus_tickets WHERE id=?', [request.id]))[0].data)
      delete oldFormat.resolutionServiceIds
      await f.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify(oldFormat), request.id])
      await f.store.syncServices(visits, { ...visits, history: [visits.history[0], completed(visit, { ticketIds: [request.id], at: '2026-10-26T13:00:00.000Z' })] }, { user: technician, reportRecordId: visit.id, now: '2026-10-26T13:00:00.000Z' })
      request = (await f.store.query(support, visits, { mode: 'detail', id: request.id })).ticket
      assert.deepEqual(request.resolutionServiceIds, [visit.id])
      assert.equal(request.status, 'Resuelto')
    })

    await t.test('resolver manualmente un caso reabierto no atribuye el resultado al informe técnico anterior', async () => {
      const c = await createCase(f, 'manual-after-reopen'), planned = { ...c.state, history: [c.record] }
      await f.store.syncServices(c.state, planned, { user: support, now: at })
      const finished = { ...planned, history: [completed(c.record)] }
      await f.store.syncServices(planned, finished, { user: technician, reportRecordId: c.record.id, now: at })
      let item = await c.detail()
      item = (await f.store.run(support, finished, cmd('reopen', { id: item.id, version: item.version, note: 'Revisar un dato adicional.' }))).ticket
      assert.ok(!item.resolvedByServiceId)
      item = (await f.store.run(support, finished, cmd('assign', { id: item.id, version: item.version, assigneeId: support.id }))).ticket
      item = (await f.store.run(support, finished, cmd('resolve', { id: item.id, version: item.version, note: 'Se aclaró el dato por teléfono.' }))).ticket
      const events = item.events.filter(entry => entry.action === 'automatic-resolved')
      assert.equal(events.length, 2)
      assert.ok(events.some(entry => entry.body.includes('Registramos la resolución')))
      assert.equal(events.filter(entry => entry.body.includes('El equipo técnico confirmó')).length, 1)
    })

    await t.test('sumar una visita a un vínculo antiguo conserva todas las obligaciones previas', async () => {
      const c = await createCase(f, 'legacy-add'), first = { ...c.record }; delete first.sourceTicketId; delete first.ticketNumber
      const second = { ...first, id: `${first.id}-2` }, state = { ...c.state, history: [first, second] }
      let item = (await f.store.run(support, state, cmd('linkService', { id: c.ticket.id, version: c.ticket.version, serviceId: first.id }))).ticket
      const legacy = JSON.parse((await f.query('SELECT data FROM pignus_tickets WHERE id=?', [item.id]))[0].data)
      delete legacy.resolutionServiceIds
      await f.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify(legacy), item.id])
      item = (await f.store.run(support, state, cmd('linkService', { id: item.id, version: item.version, serviceId: second.id }))).ticket
      assert.deepEqual(item.resolutionServiceIds.sort(), [first.id, second.id].sort())
      await f.store.syncServices(state, { ...state, history: [first, completed(second, { ticketIds: [item.id] })] }, { user: technician, reportRecordId: second.id, now: at })
      assert.equal((await c.detail()).status, 'En gestión')
    })

    await t.test('fusionar un enlace antiguo con un caso técnico conserva obligación y contexto separados', async () => {
      const c = await createCase(f, 'legacy-merge'), visit = { ...c.record }; delete visit.sourceTicketId; delete visit.ticketNumber
      const context = { ...visit, id: `${visit.id}-context` }, state = { ...c.state, history: [visit, context] }
      const source = (await f.store.run(support, state, cmd('linkService', { id: c.ticket.id, version: c.ticket.version, serviceId: visit.id }))).ticket
      const legacy = JSON.parse((await f.query('SELECT data FROM pignus_tickets WHERE id=?', [source.id]))[0].data)
      delete legacy.resolutionServiceIds
      await f.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify(legacy), source.id])
      const duplicate = await f.store.query(operator, state, { mode: 'duplicates', customerId: 'legacy-merge' })
      const target = (await f.store.run(operator, state, cmd('create', { title: 'Mismo caso ampliado desde la visita', description: 'Información adicional del técnico.', categoryId: 'alarm', subcategoryId: 'repeated', serviceId: context.id, customerId: 'legacy-merge', allowDuplicate: true, duplicateToken: duplicate.duplicateToken }))).ticket
      const merged = (await f.store.run(support, state, cmd('merge', { id: source.id, version: source.version, targetId: target.id, targetVersion: target.version, note: 'Se trata del mismo reclamo.' }))).ticket
      assert.deepEqual(merged.resolutionServiceIds, [visit.id])
      assert.deepEqual(merged.serviceIds.sort(), [visit.id, context.id].sort())
      await f.store.syncServices(state, { ...state, history: [completed(visit, { ticketIds: [source.id] }), context] }, { user: technician, reportRecordId: visit.id, now: at })
      const final = (await f.store.query(support, state, { mode: 'detail', id: target.id })).ticket
      assert.equal(final.status, 'Resuelto')
      assert.equal(final.resolvedByServiceId, visit.id)
      assert.equal(context.status, 'Pendiente')
    })

    await t.test('SLA adopta casos existentes desde ahora y crea un solo recordatorio por vencimiento y destinatario', async () => {
      const c = await createCase(f, 'sla')
      let item = (await f.store.run(support, c.state, cmd('assign', { id: c.ticket.id, version: c.ticket.version, assigneeId: support.id }))).ticket
      delete item.sla; delete item.slaStatus; item.createdAt = '2020-01-01T00:00:00.000Z'
      await f.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify(item), item.id])
      const adoptionAt = '2026-11-01T12:00:00.000Z'
      await f.store.processSla(adoptionAt)
      item = await c.detail()
      assert.equal(item.sla.startedAt, adoptionAt)
      assert.equal(item.sla.adoptedAt, adoptionAt)
      assert.equal((await c.notices(support)).length, 0)
      const overdueAt = '2026-11-05T12:00:00.000Z'
      await f.store.processSla(overdueAt)
      const notices = await c.notices(support)
      assert.equal(notices.length, 3)
      await f.store.processSla(overdueAt)
      assert.equal((await c.notices(support)).length, notices.length)
      assert.equal((await c.detail()).sla.resolutionDueAt, '2026-11-04T12:00:00.000Z')
      const latest = await c.detail()
      await f.store.run(support, c.state, cmd('markNotificationsRead', { id: latest.id }))
      assert.equal((await c.notices(support)).length, 0)
      await f.store.processSla(overdueAt)
      assert.equal((await c.notices(support)).length, 0)
    })
  } finally { await f.close() }
})
