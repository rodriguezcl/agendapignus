const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { deduplicateScheduledTasks, normalizeStateForSave } = require('../api/_lib/core.cjs')

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
  assert.match(source, /if \(!taskEditor \|\| taskEditorSaveGuardRef\.current\) return/)
  assert.match(source, /disabled=\{taskEditorSaving\}/)
  assert.match(api, /payload\.code = 'STATE_REVISION_CONFLICT'/)
})
