const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleStateForUser, visibleTechnicianStateForUser, authorizeIncomingState, normalizeStateForSave } = require('../api/_lib/core.cjs')
const { readTechnicianState } = require('../api/_lib/database.cjs')
const { recordBaseMatches, restoreServiceProposal } = require('../api/_lib/endpoint-policy.cjs')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const write = require('../api/_lib/granular-write-policy.cjs')

const actor = extra => ({ id: 'tech', roleCode: 'custom', permissions: { __catalogV2: true, 'weekly.view': true, 'records.read': true, 'planning.notes': true, 'scope.services.read.assigned': true, 'scope.services.write.assigned': true }, ...extra })
const legacy = { id: 'admin', roleCode: 'administrator', permissions: { weekly: true, history: true } }
function fixture() {
  const history = [1, 2, 3, 4].map(index => ({
    id: index === 1 ? 'journey' : `visit-${index}`, sourceTaskId: `task-${index}`,
    date: `2099-01-0${index + 4}`, time: '09:00', estimatedMinutes: 60, status: index === 3 ? 'Cancelado' : 'Pendiente',
    serviceId: 'alarm', service: 'Instalación de alarma', customerId: 'client', client: 'CLI-1 Cliente',
    technicianIds: [index === 4 ? 'tech' : 'other'], internalNote: 'Original',
    serviceJourney: { id: 'journey', index, total: 4 },
    ...(index === 1 ? { status: 'Avance registrado', technicalStatus: 'Avance registrado', technicalObservation: 'Informe original' } : {}),
    ...(index === 3 ? { awaitingConfirmation: true, technicalObservation: 'Motivo privado de la jornada cancelada' } : {})
  }))
  return {
    roles: [], employees: [], services: [{ id: 'alarm', name: 'Instalación de alarma', estimatedMinutes: 60 }], vehicles: [], reviews: [], preferences: {},
    customers: [{ customerId: 'client', account: 'CLI-1', name: 'Cliente' }], history,
    agenda: { date: history[3].date, teams: [], weekly: Object.fromEntries(history.map(record => [record.date, { teams: [{ teamId: 'team', memberIds: record.technicianIds, tasks: [{ ...record, taskId: record.sourceTaskId, historyId: record.id }] }] }])) }
  }
}

test('la proyección granular calcula 3 de 3 aunque no pueda leer la jornada cancelada', async () => {
  const { journeyLabel, journeyReportType } = await import('../src/domain/agenda/journey-progress.mjs')
  const state = fixture(), before = structuredClone(state)
  for (const user of [actor(), actor({ roleCode: 'technician', permissions: { __catalogV2: true, 'technical.view': true, 'records.read': true, 'scope.services.read.assigned': true } })]) {
    const visible = visibleStateForUser(state, user)
    assert.deepEqual(visible.history.map(record => record.id), ['visit-4'])
    const record = visible.history[0]
    assert.deepEqual(record.journeyActiveIndexes, [1, 2, 4])
    assert.equal(journeyLabel(record, visible.history), 'Jornada 3 de 3')
    assert.equal(journeyReportType(record, visible.history), 'Completado')
    assert.equal(JSON.stringify(visible).includes('Motivo privado'), false)
    if (user.roleCode === 'custom') assert.deepEqual(visible.agenda.weekly[record.date].teams[0].tasks[0].journeyActiveIndexes, [1, 2, 4])
  }
  assert.deepEqual(state, before, 'La lectura no cambia identidades, índices originales ni informes')
})

test('una visita oculta pendiente sigue contando y una cancelación técnica deja de contar', () => {
  const state = fixture()
  state.history[2].status = 'Pendiente'
  state.history[3].journeyActiveIndexes = [4] // A stale stored/client value cannot override canonical siblings.
  assert.deepEqual(visibleStateForUser(state, actor()).history[0].journeyActiveIndexes, [1, 2, 3, 4])
  state.history[2].technicalStatus = 'Cancelado'
  assert.deepEqual(visibleStateForUser(state, actor()).history[0].journeyActiveIndexes, [1, 2, 4])
})

test('la lectura móvil legacy usa cancelaciones estructurales sin exponer sus registros', async () => {
  const { journeyLabel } = await import('../src/domain/agenda/journey-progress.mjs')
  const current = fixture().history[3]
  let queryCount = 0
  const sql = async (strings, ...values) => {
    queryCount++
    const query = strings.join('?')
    assert.ok(query.includes('as journey_cancellations'))
    assert.deepEqual(values, ['tech', '2099-01-08', 'tech'])
    return [{ history: [current], journey_cancellations: [{ serviceJourney: { id: 'journey', index: 3 }, status: 'Cancelado' }], preferences: {} }]
  }
  const state = await readTechnicianState(sql, 'tech', '2099-01-08')
  assert.equal(queryCount, 1)
  for (const project of [visibleStateForUser, visibleTechnicianStateForUser]) {
    const visible = project(state, { id: 'tech', roleCode: 'technician' })
    assert.deepEqual(visible.history.map(record => record.id), ['visit-4'])
    assert.equal(journeyLabel(visible.history[0], visible.history), 'Jornada 3 de 3')
    assert.equal(Object.hasOwn(visible, 'journeyCancellations'), false)
    assert.equal(visible.history[0].serviceJourney.index, 4)
    assert.equal(current.journeyActiveIndexes, undefined)
  }
})

test('PostgreSQL real limita las cancelaciones al grupo asignado sin recuperar visitas ocultas', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
  const { journeyLabel } = await import('../src/domain/agenda/journey-progress.mjs')
  const pg = await PGlite.create()
  try {
    await pg.exec(`
      create table pignus_work_history (id text primary key, work_date date, created_at timestamptz default now(), data jsonb not null);
      create table pignus_agendas (id text primary key, data jsonb not null);
      create table pignus_preferences (key text primary key, value text);
      insert into pignus_preferences values ('state_revision', '16');
      insert into pignus_agendas values ('current', '{"weekly":{"_vehicleControls":{"paused":false}}}');
    `)
    const records = fixture().history.map(record => ({ ...record, date: record.date.replace('2099', '2020') }))
    records.push({ ...records[2], id: 'foreign-visit', customerId: 'foreign-customer', client: 'CLI-2 Otra cuenta', serviceJourney: { id: 'foreign-group', index: 3, total: 4 }, technicalObservation: 'Informe ajeno' })
    for (const record of records) await pg.query('insert into pignus_work_history (id, work_date, data) values ($1, $2::date, $3::jsonb)', [record.id, record.date, JSON.stringify(record)])
    const statements = []
    const state = await readTechnicianState(pgliteAdapter(pg, statements), 'tech', '2026-11-25')
    assert.equal(statements.length, 1)
    assert.equal(state.revision, 16)
    assert.deepEqual(state.history, [records[3]], 'Una visita pasada no habilita el historial completo de su cliente')
    assert.deepEqual(state.journeyCancellations, [{ serviceJourney: { id: 'journey', index: 3 }, status: 'Cancelado' }])
    assert.equal(JSON.stringify(state).includes('Motivo privado'), false)
    assert.equal(JSON.stringify(state).includes('Informe ajeno'), false)
    for (const project of [visibleStateForUser, visibleTechnicianStateForUser]) {
      const visible = project(state, { id: 'tech', roleCode: 'technician' })
      assert.deepEqual(visible.history.map(record => record.id), ['visit-4'])
      assert.deepEqual(visible.history[0].journeyActiveIndexes, [1, 2, 4])
      assert.equal(journeyLabel(visible.history[0], visible.history), 'Jornada 3 de 3')
      assert.equal(Object.hasOwn(visible, 'journeyCancellations'), false)
      assert.equal(JSON.stringify(visible).includes('foreign-group'), false)
    }
  } finally {
    await pg.close()
  }
})

test('cambios del contador no causan conflicto, cambios reales del servicio sí', async () => {
  const { serviceRecordChanged } = await import('../src/domain/history/service-concurrency.mjs')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const current = fixture().history[3]
  const oldView = { ...current, journeyActiveIndexes: [1, 2, 3, 4] }
  const newView = { ...current, journeyActiveIndexes: [1, 2, 4] }
  assert.equal(serviceRecordChanged(oldView, newView), false)
  assert.deepEqual(stateOperations({ history: [oldView] }, { history: [newView] }), [])
  for (const user of [actor(), legacy]) {
    assert.equal(recordBaseMatches(current, oldView, user), true)
    assert.equal(recordBaseMatches(current, { ...oldView, time: '10:00' }, user), false)
  }
  const operations = stateOperations({ history: [oldView] }, { history: [{ ...oldView, internalNote: 'Nueva' }] })
  assert.equal(applyStateOperations({ history: [newView] }, operations).history[0].internalNote, 'Nueva')
  assert.throws(() => applyStateOperations({ history: [{ ...newView, time: '10:00' }] }, operations), error => error.code === 'RECORD_WRITE_CONFLICT')
  assert.equal(serviceRecordChanged(oldView, { ...newView, time: '10:00' }), true)
})

test('editar una proyección conserva hermanos e informes y no persiste el contador', () => {
  const state = fixture(), user = actor(), visible = visibleStateForUser(state, user)
  visible.history[0].internalNote = 'Nueva'
  const next = authorizeIncomingState(visible, state, user)
  assert.equal(next.history.find(record => record.id === 'visit-4').internalNote, 'Nueva')
  assert.deepEqual(next.history.filter(record => record.id !== 'visit-4'), state.history.filter(record => record.id !== 'visit-4'))
  assert.equal(JSON.stringify(next).includes('journeyActiveIndexes'), false)
  assert.equal(next.history.find(record => record.id === 'journey').technicalObservation, 'Informe original')
  for (const subject of [user, legacy]) {
    const restored = restoreServiceProposal(state.history[3], { ...visible.history[0], journeyActiveIndexes: [4] }, subject, state)
    assert.equal(Object.hasOwn(restored, 'journeyActiveIndexes'), false)
  }
  const cloned = write.prepareServiceProposal(undefined, { id: 'new', serviceJourney: { id: 'new', index: 1, total: 2 }, journeyActiveIndexes: [1] }, user, state)
  assert.equal(Object.hasOwn(cloned, 'journeyActiveIndexes'), false)
})

test('el guardado legacy elimina contadores de historial y ambas agendas', () => {
  const state = fixture(), incoming = structuredClone(state)
  incoming.agenda.teams = structuredClone(incoming.agenda.weekly[incoming.agenda.date].teams)
  for (const record of incoming.history) record.journeyActiveIndexes = [1, 2, 4]
  for (const team of [...incoming.agenda.teams, ...Object.values(incoming.agenda.weekly).flatMap(day => day.teams)]) for (const task of team.tasks) task.journeyActiveIndexes = [1, 2, 4]
  incoming.journeyCancellations = [{ serviceJourney: { id: 'injected', index: 1 }, status: 'Cancelado' }]
  const next = authorizeIncomingState(incoming, state, legacy)
  assert.equal(JSON.stringify(next).includes('journeyActiveIndexes'), false)
  assert.equal(Object.hasOwn(next, 'journeyCancellations'), false)
  const normalized = normalizeStateForSave(incoming, state)
  assert.equal(JSON.stringify(normalized).includes('journeyActiveIndexes'), false)
  assert.equal(Object.hasOwn(normalized, 'journeyCancellations'), false)
  assert.equal(incoming.history[3].journeyActiveIndexes.length, 3, 'La limpieza no muta el formulario de origen')
})
