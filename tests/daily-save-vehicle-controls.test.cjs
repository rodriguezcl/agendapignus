const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const start = source.indexOf('      const records = agendaTeams.flatMap')
const code = source.slice(start, source.indexOf('      if (!records.length)', start))

function recordsFor(agendaTeams, onlyTaskId = null) {
  return vm.runInNewContext(code + '\nrecords', {
    agendaTeams, onlyTaskId, date: '2026-09-18',
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
