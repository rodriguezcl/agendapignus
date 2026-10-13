const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { startTechnicianServiceRecord } = require('../api/_lib/technician-service-start.cjs')
const from = '2026-10-13', to = '2026-10-15', now = '2026-10-13T18:00:00Z'
const fixture = () => {
  const record = { id: 'service', sourceTaskId: 'task', date: from, time: '08:30', status: 'Pendiente', startedAt: '2026-10-13T12:41:00Z', startedById: 'tech', startedByName: 'Técnico', technicianIds: ['tech'], technicians: ['Técnico'], technicalObservation: 'Trabajo parcial', servicePreparation: { ready: true }, photo: 'saved-photo', detail: 'Instalar cámaras' }
  const task = { ...record, taskId: 'task', historyId: 'service' }
  const team = { teamId: 'a', label: 'Equipo 1', memberIds: ['tech'], members: ['Técnico'] }
  return { record, task, team, state: { history: [record], agenda: { date: to, teams: [{ ...team, tasks: [] }], weekly: { [from]: { teams: [{ ...team, tasks: [task] }] }, [to]: { teams: [{ ...team, tasks: [] }] } } } } }
}

for (const path of ['daily', 'weekly', 'history']) test(`${path}: next visit resets start, keeps identity, evidence, photo and readiness`, async () => {
  const { weeklyServiceOperations, weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  const { state, record, task, team } = fixture()
  const command = { day: to, sourceDay: from, sourceTeamId: 'a', team, baseTask: task, baseRecord: record, task: { ...task, time: '11:30' }, record: { ...record, date: to, time: '11:30', reprogrammedAt: now } }
  const ops = path === 'history' ? historyRescheduleOperations(state, { base: record, day: to, time: '11:30', team, today: from, now }) : (path === 'weekly' ? weeklyServiceMoveOperations : weeklyServiceOperations)(state, command)
  const next = applyStateOperations(state, ops), saved = next.history[0]
  assert.equal(next.history.length, 1)
  assert.equal(saved.id, record.id)
  assert.equal(saved.startedAt, '')
  assert.equal(saved.technicalObservation, '')
  assert.deepEqual(saved.servicePreparation, record.servicePreparation)
  assert.equal(saved.photo, record.photo)
  assert.equal(saved.reschedulingHistory.length, 1)
  assert.equal(saved.reschedulingHistory[0].startedAt, record.startedAt)
  assert.equal(saved.reschedulingHistory[0].technicalObservation, 'Trabajo parcial')
  assert.equal(next.agenda.weekly[from].teams[0].tasks.length, 0)
  for (const copy of [next.agenda.weekly[to].teams[0].tasks[0], next.agenda.teams[0].tasks[0]]) assert.equal(copy.startedAt, '')
  assert.equal(startTechnicianServiceRecord(saved, { id: 'tech' }, '2026-10-15T14:30:00Z').startedAt, '2026-10-15T14:30:00Z')
  assert.deepEqual(applyStateOperations(next, ops), next)
  const concurrent = structuredClone(state); concurrent.history[0].technicalObservation = 'Otro informe'
  assert.throws(() => applyStateOperations(concurrent, ops), { code: 'RECORD_WRITE_CONFLICT' })
})

test('same-day reassignment preserves the active visit', async () => {
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { state, record, task, team } = fixture()
  const next = applyStateOperations(state, weeklyServiceOperations(state, { day: from, sourceDay: from, sourceTeamId: 'a', team: { ...team, teamId: 'b' }, record, task, baseRecord: record, baseTask: task }))
  assert.equal(next.history[0].startedAt, record.startedAt)
  assert.equal(next.history[0].reschedulingHistory, undefined)
})

test('repair is narrow, idempotent and retains evidence without inventing old schedule', async () => {
  const { repairMovedServiceStart } = await import('../src/domain/agenda/service-rescheduling.mjs')
  const { record } = fixture()
  const moved = { ...record, date: to, time: '11:30', rescheduledFrom: from, reprogrammedAt: now }
  const fixed = repairMovedServiceStart(moved)
  assert.equal(fixed.startedAt, '')
  assert.equal(fixed.date, to)
  assert.equal(fixed.time, '11:30')
  assert.equal(fixed.reschedulingHistory[0].date, from)
  assert.equal(fixed.reschedulingHistory[0].time, undefined)
  assert.equal(fixed.reschedulingHistory[0].startedAt, record.startedAt)
  assert.deepEqual(repairMovedServiceStart(fixed), fixed)
  for (const patch of [{ status: 'Completado' }, { vehicleControl: true }, { technicalStatus: 'Cancelado' }, { completedAt: now }, { startedAt: '2026-10-15T14:30:00Z' }, { reprogrammedAt: '' }, { rescheduledFrom: to }]) {
    const untouched = { ...moved, ...patch }; assert.equal(repairMovedServiceStart(untouched), untouched)
  }
})

test('targeted repair updates both projections, keeps unrelated jobs and is idempotent', async () => {
  const { repairMovedServiceState } = await import('../src/domain/agenda/service-rescheduling.mjs')
  const { state, record, task, team } = fixture()
  const moved = { ...record, date: to, time: '11:30', rescheduledFrom: from, reprogrammedAt: now }
  state.history = [moved, { id: 'unrelated', status: 'Completado', startedAt: record.startedAt }]
  state.agenda.weekly[from].teams[0].tasks = []
  const destination = { ...team, tasks: [{ ...task, ...moved }] }
  state.agenda.teams = [destination]
  state.agenda.weekly[to].teams = [destination]
  const next = repairMovedServiceState(state, moved.id)
  assert.equal(next.history[0].startedAt, '')
  assert.equal(next.agenda.teams[0].tasks[0].startedAt, '')
  assert.equal(next.agenda.weekly[to].teams[0].tasks[0].startedAt, '')
  assert.equal(next.agenda.weekly[to].teams[0].tasks[0].time, '11:30')
  assert.deepEqual(next.history[1], state.history[1])
  assert.deepEqual(next.agenda.weekly[from], state.agenda.weekly[from])
  assert.equal(next.history[0].servicePreparation.ready, true)
  assert.equal(repairMovedServiceState(next, moved.id), next)
  assert.equal(state.history[0].startedAt, record.startedAt)
})

test('previous visit UI renders dates, start and observation as text', () => {
  const { buildSync } = require('esbuild'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const Module = require('node:module'), path = require('node:path')
  const filename = path.resolve('src/components/ReschedulingHistory.jsx')
  const result = buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'] })
  const compiled = new Module(filename, module); compiled.paths = module.paths; compiled._compile(result.outputFiles[0].text, filename)
  const html = renderToStaticMarkup(React.createElement(compiled.exports.default, { record: { reschedulingHistory: [{ date: from, startedAt: '2026-10-13T12:41:00Z', technicalObservation: '<script>observación</script>', reprogrammedAt: now }] } }))
  assert.match(html, /13\/10\/2026/)
  assert.match(html, /09:41/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /Visitas anteriores/)
})
