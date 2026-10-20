const { frontendSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { isGranular } = require('../api/_lib/permission-catalog.cjs')
const source = frontendSource()
const start = source.indexOf('      const records = agendaTeams.flatMap')
const code = source.slice(start, source.indexOf('      if (!records.length)', start))

function recordsFor(agendaTeams, onlyTaskId = null, { authUser = null, changed = [] } = {}) {
  return vm.runInNewContext(code + '\nrecords', {
    agendaTeams, onlyTaskId, authUser, changed, isGranular,
    dailyCompleted: task => task.status === 'Completado', date: '2026-09-18',
    serviceEstimateForTask: () => 90, serviceForTask: task => ({ id: task.serviceId, name: task.service }),
    normalizeInternalChecklist: value => value || [], applicableServiceExtras: () => ({}), serviceTrace: () => ({})
  })
}

test('daily save does not rebuild automatic controls with all team members', () => {
  const control = { taskId: 'control-1', historyId: 'control-1', vehicleControl: true, vehicleId: 'v1', technicianIds: ['t1'], client: 'Vehículo', serviceId: 'vehicle-control' }
  const service = { taskId: 'job-1', historyId: 'job-1', time: '08:45', client: 'Cliente', serviceId: 's1', service: 'Instalación' }
  const teams = [{ teamId: 'team-1', memberIds: ['t1', 't2'], members: ['Uno', 'Dos'], tasks: [control, service] }]
  const before = JSON.stringify(teams)
  const records = recordsFor(teams)
  assert.equal(records.length, 1)
  assert.equal(records[0].id, 'job-1')
  assert.deepEqual(Array.from(records[0].technicianIds), ['t1', 't2'])
  assert.equal(JSON.stringify(teams), before)
  assert.equal(recordsFor(teams, 'job-1').length, 1)
})

test('a day with only automatic controls needs no manual history write', () => {
  assert.equal(recordsFor([{ tasks: [{ vehicleControl: true }] }]).length, 0)
  assert.match(source.slice(start), /if \(!records.length\) return true/)
  assert.match(source, /if \(!await registerHistory\(agendaTeams\)\) return[\s\S]*?navigator.clipboard\?\.writeText\(message\)/)
})

test('granular daily save includes only changed selected services and still excludes controls and completed work', () => {
  const base = { time: '09:00', client: 'Cliente', serviceId: 's1', service: 'Instalación' }
  const changedService = { ...base, taskId: 'changed', historyId: 'changed' }
  const unchangedService = { ...base, taskId: 'unchanged', historyId: 'unchanged' }
  const completedService = { ...base, taskId: 'completed', status: 'Completado' }
  const control = { ...base, taskId: 'control', vehicleControl: true, technicianIds: ['t1'] }
  const teams = [{ teamId: 'team-1', memberIds: ['t1', 't2'], members: ['Uno', 'Dos'], tasks: [changedService, unchangedService, completedService, control] }]
  const before = JSON.stringify(teams)
  const options = { authUser: { permissions: { __catalogV2: true } }, changed: [changedService, completedService, control] }
  assert.deepEqual(Array.from(recordsFor(teams, null, options), record => record.id), ['changed'])
  assert.equal(recordsFor(teams, 'changed', options).length, 1)
  assert.equal(recordsFor(teams, 'unchanged', options).length, 0)
  assert.equal(recordsFor(teams, null, { ...options, changed: [] }).length, 0)
  assert.deepEqual(Array.from(recordsFor(teams), record => record.id), ['changed', 'unchanged'], 'el guardado legacy conserva su selección anterior')
  assert.equal(JSON.stringify(teams), before, 'el filtro no modifica servicios ni asignaciones')
})
