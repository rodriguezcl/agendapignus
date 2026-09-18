const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const bundle = buildSync({ stdin: { contents: source + '\nexport { dailyPlanWithMonthlyTeams, applyRemovedWeeklyTeams, applyRemovedWeeklySlots, applyRemovedWeeklyTasks };', loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
const compiled = new Module(path.join(root, 'test-daily-plan.cjs'), module)
compiled.paths = module.paths
compiled._compile(bundle.outputFiles[0].text, path.join(root, 'test-daily-plan.cjs'))
const { dailyPlanWithMonthlyTeams, applyRemovedWeeklyTeams, applyRemovedWeeklySlots, applyRemovedWeeklyTasks } = compiled.exports
const day = '2026-09-21'
const monthly = ['Rodrigo', 'Mariano', 'Leonardo'].map((name, index) => ({ teamId: `team-${index + 1}`, label: `Equipo ${index + 1}`, memberIds: [name], members: [name] }))
const fixture = () => ({ _monthlyTeams: { '2026-09': { teams: structuredClone(monthly) } }, [day]: { teams: [{ teamId: 'team-1', label: 'Equipo 1', memberIds: ['Pascual'], members: ['Pascual'], tasks: [] }] } })

test('partial Monday loads all three monthly teams and keeps the daily technician exception', () => {
  const weekly = fixture()
  const before = structuredClone(weekly)
  const plan = dailyPlanWithMonthlyTeams(day, weekly)
  assert.deepEqual(plan.teams.map(team => team.teamId), ['team-1', 'team-2', 'team-3'])
  assert.deepEqual(plan.teams.map(team => team.members), [['Pascual'], ['Mariano'], ['Leonardo']])
  assert.ok(plan.teams.every(team => team.tasks.length > 0))
  assert.deepEqual(weekly, before)
})

test('unmaterialized dates also load the monthly teams, while other months do not inherit them', () => {
  const weekly = fixture()
  assert.deepEqual(dailyPlanWithMonthlyTeams('2026-09-22', weekly).teams.map(team => team.members), monthly.map(team => team.members))
  assert.equal(dailyPlanWithMonthlyTeams('2026-10-01', weekly), undefined)
})

test('saved services retain their data and intentional removals remain effective', () => {
  const weekly = fixture()
  const task = { taskId: 'saved', service: 'Instalación', client: 'Cliente', time: '08:45', amount: '260000' }
  weekly[day].teams[0].tasks.push(task)
  weekly[day].removedTeams = [{ teamId: 'team-2', teamNumber: 2 }]
  const plan = dailyPlanWithMonthlyTeams(day, weekly)
  const visible = applyRemovedWeeklyTeams(applyRemovedWeeklySlots(applyRemovedWeeklyTasks(plan.teams, plan.removedTaskIds || []), plan.removedSlots || []), plan.removedTeams)
  assert.deepEqual(visible.map(team => team.teamId), ['team-1', 'team-3'])
  assert.deepEqual(visible[0].tasks.find(item => item.taskId === 'saved'), task)
  assert.equal(visible[0].tasks.filter(item => item.time === '08:45').length, 1)
})

test('Saturday keeps its annual guard and does not import ordinary monthly teams', () => {
  const weekly = fixture()
  const saturday = '2026-09-26'
  weekly[saturday] = { teams: [{ teamId: 'guard', members: ['Santos'], tasks: [] }] }
  assert.deepEqual(dailyPlanWithMonthlyTeams(saturday, weekly), weekly[saturday])
})

test('daily loader uses the monthly merge and waits for its date before syncing back', () => {
  assert.match(source, /const weeklyDay = dailyPlanWithMonthlyTeams\(nextDate, weekly\)/)
  assert.match(source, /if \(loadedAgendaDate.current !== date\) return/)
})
