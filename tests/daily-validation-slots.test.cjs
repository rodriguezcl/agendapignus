const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
test('ignora controles y espacios vacíos, y conserva la numeración visual', () => {
  const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  const start = source.indexOf('  const validateAgenda = (agendaTeams = teams, onlyTaskId = null)')
  const code = source.slice(start, source.indexOf('  const clearAgenda', start))
  let errors = []
  const validate = vm.runInNewContext(code + '\nvalidateAgenda', {
    teams: [], date: '2099-09-18', history: [],
    taskHasContent: task => Boolean(task.service), taskIsResolvedForPlanning: () => false,
    serviceForTask: () => ({}), isTrainingService: () => false, serviceCode: () => '',
    requiresPaymentAmount: () => false, invalidFormEmail: () => false, serviceTimeInMinutes: () => null,
    currentLocalDate: () => '2026-09-17', taskForScheduleOccupancy: () => null,
    minimumServiceGapConflicts: () => [], showAgendaValidationModal: value => { errors = value }
  })
  const tasks = [{ time: '08:45' }, { vehicleControl: true, service: 'Control vehicular' }]
  assert.equal(validate([{ tasks }]), true)
  assert.equal(validate([{ tasks: [...tasks, { time: '14:00', service: 'Instalación' }] }]), false)
  assert.match(errors[0], /^Equipo 1, servicio 3:/)
})
