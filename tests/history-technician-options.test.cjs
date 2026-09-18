const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const app = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const source = app.slice(app.indexOf('function HistoryManagementDetail'), app.indexOf('function HistoryDetail('))

test('history edit displays team and technicians read-only', () => {
  assert.match(source, /<label>Equipo<input readOnly/)
  assert.match(source, /<label>Técnicos asignados<input readOnly/)
  assert.doesNotMatch(source, /<select multiple/)
})

test('saving preserves team and members even if draft contains different IDs', () => {
  const line = source.split(/\r?\n/).find(line => line.includes('const patch = { ...draft,'))
  const record = { teamId: 'team1', team: 'Equipo 1', technicianIds: ['tech1', 'tech2'], technicians: ['Uno', 'Dos'] }
  const patch = vm.runInNewContext(line + '\npatch', {
    record, identityLocked: false, draft: { teamId: 'team2', team: 'Equipo 2', technicianIds: ['admin'], estimatedMinutes: 90 },
    customer: {}, authUser: {}, customerLinkPatch: () => ({}), service: { id: 's', name: 'Service' }
  })
  for (const key of ['teamId', 'team', 'technicianIds', 'technicians']) assert.deepEqual(patch[key], record[key])
  assert.equal(patch.estimatedMinutes, 90)
})
