const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('daily training name shares the customer grid position and buffered editing', () => {
  const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  const field = source.split('\n').find(line => line.includes('const dailyCustomerField ='))
  assert.match(field, /\? <label className="daily-field-customer">/)
  assert.match(field, /<BufferedInput/)
  const css = fs.readFileSync(require.resolve('../src/ui-polish.css'), 'utf8')
  assert.match(css, /\.daily-field-customer \{ grid-column: 4; grid-row: 1; \}/)
})

test('Capacitación permits a descriptive name without a customer or contact', async () => {
  const { isTrainingService, trainingClientPatch, serviceCode } = await import('../src/domain/services/service.mjs')
  assert.equal(isTrainingService({ name: ' CAPACITACIÓN ' }), true)
  assert.equal(isTrainingService({ name: 'Instalación de cámaras' }), false)
  const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  const body = source.slice(source.indexOf('const weeklyTaskMissingFields ='), source.indexOf('const weeklyTaskReadyToSave ='))
  const missing = vm.runInNewContext(body + '\nweeklyTaskMissingFields', { isTrainingService, serviceCode, requiresPaymentAmount: () => false })
  const task = { ...trainingClientPatch('CAPACITACIÓN CERCO ELÉCTRICO'), time: '14:00', service: 'Capacitación', address: 'Sala de capacitación', detail: 'Práctica de instalación', phone: '' }
  assert.equal(missing(task, { name: 'Capacitación' }).length, 0)
  assert.ok(missing({ ...task, client: '' }, { name: 'Capacitación' }).includes('cliente'))
  assert.ok(missing({ ...task, address: '' }, { name: 'Capacitación' }).includes('dirección'))
  const ordinary = missing(task, { name: 'Service de alarma' })
  assert.ok(ordinary.includes('cliente'))
  assert.ok(ordinary.includes('contacto'))
  assert.equal(task.newCustomer, false)
  assert.equal(task.subscriberReservation, false)
  assert.equal(task.customerId, '')
})

test('weekly persistence preserves training without creating a CLI', async () => {
  const { trainingClientPatch } = await import('../src/domain/services/service.mjs')
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
  const day = '2096-09-11'
  const team = { teamId: 'team-1', members: ['Técnico'], memberIds: ['tech-1'], tasks: [] }
  const state = { customers: [], history: [], agenda: { date: day, teams: [], weekly: { [day]: { teams: [team] } } } }
  const task = { ...trainingClientPatch('CAPACITACIÓN CERCO ELÉCTRICO'), taskId: 'training-1', serviceId: 'training', service: 'Capacitación', address: 'Sala 1', phone: '', time: '14:00', estimatedMinutes: 60 }
  const record = { ...task, id: 'history-1', sourceTaskId: task.taskId, date: day, teamId: team.teamId }
  const saved = applyStateOperations(state, weeklyServiceOperations(state, { day, team, task, record }))
  assert.equal(saved.customers.length, 0)
  assert.equal(saved.history[0].client, task.client)
  assert.equal(saved.history[0].phone, '')
  assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].address, 'Sala 1')
})
