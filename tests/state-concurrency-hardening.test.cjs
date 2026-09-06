const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { deduplicateScheduledTasks, normalizeStateForSave } = require('../api/_lib/core.cjs')
const { concurrentStateChanged, mergeConcurrentState } = require('../api/_lib/state-merge.cjs')
const { stateConcurrencyEvent } = require('../api/_lib/concurrency-observability.cjs')

test('la telemetría de concurrencia es estructurada y no incluye datos funcionales', () => {
  const event = stateConcurrencyEvent('state_write_conflict', {
    actorRole: 'administrator',
    expectedRevision: 8,
    currentRevision: 9,
    conflictPath: 'agenda.2026-09.2026-09-07[team:team-1]',
    customer: 'dato que no debe registrarse'
  }, new Date('2026-09-06T18:00:00.000Z'))

  assert.deepEqual(event, {
    timestamp: '2026-09-06T18:00:00.000Z',
    scope: 'state_concurrency',
    event: 'state_write_conflict',
    code: 'STATE_WRITE_CONFLICT',
    actorRole: 'administrator',
    expectedRevision: 8,
    currentRevision: 9,
    conflictPath: 'agenda.2026-09.2026-09-07[team:team-1]'
  })
})

test('detecta una fusión real aunque la colección privada no esté en el cliente', () => {
  const base = { services: [{ id: 'service-1', name: 'Original' }] }
  assert.equal(concurrentStateChanged(base, { ...base, reviews: [{ id: 'private-review' }] }), false)
  assert.equal(concurrentStateChanged(base, { services: [{ id: 'service-1', name: 'Actualizado' }], reviews: [] }), true)
})

test('la base compacta incluye sólo las secciones modificadas', async () => {
  const { compactStateBase } = await import('../src/features/state/application/compact-state-base.mjs')
  const customers = Array.from({ length: 1000 }, (_, index) => ({ customerId: `customer-${index}`, name: `Cliente ${index}` }))
  const base = { customers, services: [{ id: 'service-1' }], agenda: { date: '2026-09-06', teams: [] }, preferences: { theme: 'light' } }
  const next = { ...base, agenda: { ...base.agenda, date: '2026-09-07' } }
  const compact = compactStateBase(base, next)

  assert.deepEqual(Object.keys(compact), ['agenda'])
  assert.equal(JSON.stringify(compact).length < JSON.stringify(base).length / 10, true)
})

test('una base parcial fusiona lo modificado y preserva las demás colecciones', () => {
  const base = { agenda: { date: '2026-09-06', teams: [] } }
  const current = { agenda: base.agenda, customers: [{ customerId: 'customer-1', name: 'Vigente' }] }
  const incoming = { agenda: { date: '2026-09-07', teams: [] }, customers: [] }
  const merged = mergeConcurrentState(base, current, incoming)

  assert.equal(merged.agenda.date, '2026-09-07')
  assert.deepEqual(merged.customers, current.customers)
})

test('fusiona altas simultáneas sobre registros diferentes', () => {
  const base = { services: [{ id: 'service-1', name: 'Base' }] }
  const current = { services: [...base.services, { id: 'service-a', name: 'Alta A' }] }
  const incoming = { services: [...base.services, { id: 'service-b', name: 'Alta B' }] }

  assert.deepEqual(mergeConcurrentState(base, current, incoming).services.map(service => service.id), ['service-1', 'service-a', 'service-b'])
})

test('fusiona servicios distintos agregados al mismo equipo y día', () => {
  const scheduled = taskId => ({ taskId, serviceId: 'service-1', time: '10:00' })
  const agendaWith = services => ({
    '2026-09': {
      '2026-09-07': [{ teamId: 'team-1', members: ['Técnico 1'], services }]
    }
  })
  const base = { agenda: agendaWith([scheduled('task-base')]) }
  const current = { agenda: agendaWith([scheduled('task-base'), scheduled('task-a')]) }
  const incoming = { agenda: agendaWith([scheduled('task-base'), scheduled('task-b')]) }

  const mergedServices = mergeConcurrentState(base, current, incoming).agenda['2026-09']['2026-09-07'][0].services
  assert.deepEqual(mergedServices.map(service => service.taskId), ['task-base', 'task-a', 'task-b'])
})

test('fusiona campos distintos del mismo servicio y rechaza el mismo campo', () => {
  const base = { history: [{ id: 'record-1', time: '10:00', detail: 'Original', status: 'Pendiente' }] }
  const current = { history: [{ ...base.history[0], time: '10:30' }] }
  const compatible = { history: [{ ...base.history[0], detail: 'Detalle nuevo' }] }
  const conflicting = { history: [{ ...base.history[0], time: '11:00' }] }

  assert.deepEqual(mergeConcurrentState(base, current, compatible).history[0], { id: 'record-1', time: '10:30', detail: 'Detalle nuevo', status: 'Pendiente' })
  assert.throws(() => mergeConcurrentState(base, current, conflicting), error => error.statusCode === 409 && error.code === 'STATE_WRITE_CONFLICT' && error.conflictPath.includes('.time'))
})

test('rechaza eliminar un registro que fue modificado en otra sesión', () => {
  const base = { history: [{ id: 'record-1', detail: 'Original' }] }
  const current = { history: [{ id: 'record-1', detail: 'Actualizado' }] }
  const incoming = { history: [] }

  assert.throws(() => mergeConcurrentState(base, current, incoming), /también cambiaron en otra sesión/)
})

test('deduplica una misma alta por taskId aunque llegue repetida o en otro equipo', () => {
  const repeated = { taskId: 'task-1', serviceId: 'service-1', service: 'Mantenimiento', time: '10:00' }
  const teams = deduplicateScheduledTasks([
    { teamId: 'team-1', tasks: [repeated, { ...repeated }] },
    { teamId: 'team-2', tasks: [{ ...repeated }, { taskId: 'task-2', serviceId: 'service-1', service: 'Mantenimiento', time: '12:00' }] }
  ])

  assert.deepEqual(teams.map(team => team.tasks.map(task => task.taskId)), [['task-1'], ['task-2']])
})

test('la normalización del servidor aplica la idempotencia en agenda diaria y semanal', () => {
  const service = { id: 'service-1', code: 'maintenance', name: 'Mantenimiento', estimatedMinutes: 60, status: 'Activo' }
  const task = { taskId: 'task-1', serviceId: service.id, service: service.name, time: '10:00' }
  const state = {
    roles: [], employees: [], services: [service], vehicles: [], customers: [], history: [], reviews: [], preferences: { theme: 'light' },
    agenda: {
      date: '2099-01-05',
      teams: [{ teamId: 'team-1', tasks: [task, { ...task }] }],
      weekly: { '2099-01-05': { teams: [{ teamId: 'team-1', tasks: [task, { ...task }] }] } }
    }
  }
  const normalized = normalizeStateForSave(state, state)

  assert.equal(normalized.agenda.teams[0].tasks.length, 1)
  assert.equal(normalized.agenda.weekly['2099-01-05'].teams[0].tasks.length, 1)
})

test('un 409 invalida la cola pendiente antes de recuperar el estado remoto', async () => {
  const { recoverStateRevisionConflict, STATE_REVISION_CONFLICT_NOTICE } = await import('../src/features/state/application/state-save-conflict.mjs')
  const calls = []
  const handled = await recoverStateRevisionConflict(
    { status: 409, payload: { code: 'STATE_REVISION_CONFLICT' } },
    {
      invalidatePendingSaves: () => calls.push('invalidate'),
      loadRemoteState: async () => { calls.push('load'); return { revision: 8 } },
      applyRemoteState: state => calls.push(`apply:${state.revision}`),
      notify: message => calls.push(message)
    }
  )

  assert.equal(handled, true)
  assert.deepEqual(calls, ['invalidate', 'load', 'apply:8', STATE_REVISION_CONFLICT_NOTICE])
})

test('no absorbe errores que no sean conflictos de revisión', async () => {
  const { recoverStateRevisionConflict } = await import('../src/features/state/application/state-save-conflict.mjs')
  let invalidated = false
  const handled = await recoverStateRevisionConflict({ status: 400 }, {
    invalidatePendingSaves: () => { invalidated = true },
    loadRemoteState: async () => ({}),
    applyRemoteState: () => {},
    notify: () => {}
  })

  assert.equal(handled, false)
  assert.equal(invalidated, false)
})

test('la interfaz bloquea doble guardado y descarta instantáneas encoladas obsoletas', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8')

  assert.match(source, /const stateSaveGenerationRef = useRef\(0\)/)
  assert.match(source, /if \(saveGeneration !== stateSaveGenerationRef\.current\) return/)
  assert.match(source, /invalidatePendingSaves: \(\) => \{ stateSaveGenerationRef\.current \+= 1 \}/)
  assert.match(source, /const changedBase = base \? compactStateBase\(base, snapshot\) : null/)
  assert.match(source, /changedBase && Object\.keys\(changedBase\)\.length \? \{ base: changedBase \} : \{\}/)
  assert.match(source, /payload\.state && currentSnapshotRef\.current === serializedStateSnapshot/)
  assert.match(source, /if \(!taskEditor \|\| taskEditorSaveGuardRef\.current\) return/)
  assert.match(source, /disabled=\{taskEditorSaving\}/)
  assert.match(api, /payload\.code = error\.code \|\| 'STATE_REVISION_CONFLICT'/)
})
