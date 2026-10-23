const test = require('node:test')
const assert = require('node:assert/strict')

test('el borrador de agenda toma los datos vigentes de la cuenta y conserva el identificador del ticket', async () => {
  const { ticketServiceDraft, ticketReferenceDetail, ticketLinkFields } = await import('../src/features/agenda/application/ticket-service-draft.mjs')
  const ticket = { id: 'ticket-1', number: '453276', status: 'En gestión', customerId: 'customer-1', title: 'Cámaras sin imagen', description: 'Revisar cámara de acceso', customerSnapshot: { address: 'Domicilio anterior' } }
  const draft = ticketServiceDraft(ticket, [{ customerId: 'customer-1', account: 'PIG-1200', name: 'CLIENTE', address: 'Domicilio actual', phone: '1234' }], { id: 'support' })
  assert.equal(draft.address, 'Domicilio actual')
  assert.equal(draft.sourceTicketId, 'ticket-1')
  assert.equal(draft.ticketNumber, '453276')
  assert.match(draft.detail, /^Ticket#453276 · Cámaras sin imagen/)
  assert.match(draft.detail, /Revisar cámara de acceso/)
  assert.equal(ticketReferenceDetail(draft.detail, '453276'), draft.detail)
  assert.equal(ticketReferenceDetail('Nueva observación', '453276'), 'Ticket#453276 · Nueva observación')
  assert.deepEqual(ticketLinkFields({ sourceTicketId: 'another', ticketNumber: '1' }, draft), { sourceTicketId: 'ticket-1', ticketNumber: '453276' })
  assert.throws(() => ticketServiceDraft({ ...ticket, status: 'Resuelto' }, [], {}), /ya no está abierto/)
  assert.throws(() => ticketServiceDraft(ticket, [], {}), /vinculá el ticket/)
})

test('el informe técnico transmite la confirmación explícita y distingue el pedido adicional del reclamo resuelto', async () => {
  const { submitTechnicianStatus } = await import('../src/infrastructure/http/technician-status.mjs')
  let payload
  const fetcher = async (url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ record: { id: 'service-1' } }) } }
  await submitTechnicianStatus({ recordId: 'service-1', type: 'Completado', observation: 'Se restableció la imagen.', ticketResolution: { resolved: true, ticketIds: ['ticket-1'] }, followup: { type: 'Cotizar adicional', description: 'Cotizar cámara para patio', relatedTicketId: '', relation: 'different' }, fetcher })
  assert.deepEqual(payload.ticketResolution, { resolved: true, ticketIds: ['ticket-1'] })
  assert.equal(payload.followup.relation, 'different')
  assert.equal(payload.followup.relatedTicketId, '')
  await submitTechnicianStatus({ recordId: 'service-1', type: 'Completado', observation: 'Requiere otra visita.', ticketResolution: { resolved: false }, fetcher })
  assert.deepEqual(payload.ticketResolution, { resolved: false })
})

test('la planificación en varias jornadas conserva el vínculo con el reclamo', async () => {
  const { planServiceJourneyOperations } = await import('../src/features/state/application/service-journeys.mjs')
  const record = { id: 'work-task-1', sourceTaskId: 'task-1', sourceTicketId: 'ticket-1', ticketNumber: '453276', date: '2026-10-26', time: '08:30', scheduledTime: '08:30', estimatedMinutes: 60, status: 'Pendiente', teamId: 'team-1', team: 'Equipo 1', technicianIds: ['tech-1'], technicians: ['Técnico'], client: 'PIG-1200 CLIENTE', customerId: 'customer-1', service: 'Service de cámaras', detail: 'Ticket#453276 · Sin imagen' }
  const team = { teamId: 'team-1', label: 'Equipo 1', memberIds: ['tech-1'], members: ['Técnico'], tasks: [] }
  const snapshot = { history: [record], agenda: { weekly: {} } }
  const operations = planServiceJourneyOperations(snapshot, { base: record, visits: [{ date: '2026-10-26', time: '08:30', estimatedMinutes: 60, teamId: 'team-1' }, { date: '2026-10-27', time: '08:30', estimatedMinutes: 60, teamId: 'team-1' }], today: '2026-10-23', teamsForDate: () => [team], createId: () => 'task-2' })
  const child = operations.find(operation => operation.path[0] === 'history' && operation.after?.id === 'work-task-2')?.after
  assert.ok(child)
  assert.equal(child.sourceTicketId, 'ticket-1')
  assert.equal(child.ticketNumber, '453276')
})
