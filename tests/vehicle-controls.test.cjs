const test = require('node:test')
const assert = require('node:assert/strict')

const technicians = [
  { id: 'rodrigo', name: 'Rodrigo Gonzalez' }, { id: 'pascual', name: 'Pascual Gonzalez' },
  { id: 'mariano', name: 'Mariano Diaz Tillard' }, { id: 'santos', name: 'Santos Diaz' },
  { id: 'leonardo', name: 'Leonardo Rivadero' }
]
const teams = [
  { teamId: 'one', label: 'Equipo 1', memberIds: ['rodrigo', 'pascual'], members: ['Rodrigo Gonzalez', 'Pascual Gonzalez'] },
  { teamId: 'two', label: 'Equipo 2', memberIds: ['mariano', 'santos'], members: ['Mariano Diaz Tillard', 'Santos Diaz'] },
  { teamId: 'three', label: 'Equipo 3', memberIds: ['leonardo'], members: ['Leonardo Rivadero'] }
]
const vehicles = [
  { id: 'ka', brand: 'Ford', model: 'Ka', plate: 'AA111AA', mileage: 80000 },
  { id: 'van', brand: 'Renault', model: 'Kangoo', plate: 'AB222AB', mileage: 90000 },
  { id: 'car', brand: 'Fiat', model: 'Cronos', plate: 'AC333AC', mileage: 70000 }
]

test('asigna el Ford Ka al técnico que trabaja solo', async () => {
  const { suggestedVehicleAssignments } = await import('../src/vehicle-controls.mjs')
  const assignments = suggestedVehicleAssignments(vehicles, teams)
  assert.equal(assignments.find(item => item.vehicleId === 'ka').technicianId, 'leonardo')
  assert.equal(new Set(assignments.map(item => item.technicianId)).size, vehicles.length)
})

test('coordina cada mes el Ford Ka con la salida individual sugerida', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  const { suggestedVehicleAssignments } = await import('../src/vehicle-controls.mjs')
  const history = []
  const fordResponsibles = []
  for (let monthNumber = 1; monthNumber <= 5; monthNumber += 1) {
    const month = `2026-${String(monthNumber).padStart(2, '0')}`
    const groups = monthlyTeamRotation(technicians, month, '2026-01', vehicles.length)
    const monthlyTeams = groups.map((members, index) => ({ teamId: `team-${index}`, memberIds: members.map(technician => technician.id), members: members.map(technician => technician.name) }))
    const assignments = suggestedVehicleAssignments(vehicles, monthlyTeams, { month, assignmentHistory: history })
    const soloId = groups.find(group => group.length === 1)[0].id
    const fordResponsible = assignments.find(assignment => assignment.vehicleId === 'ka').technicianId
    assert.equal(fordResponsible, soloId)
    assert.equal(new Set(assignments.map(assignment => assignment.technicianId)).size, vehicles.length)
    fordResponsibles.push(fordResponsible)
    history.push(assignments)
  }
  assert.equal(new Set(fordResponsibles).size, 5)
})

test('escala responsables al agregar un técnico y un vehículo', async () => {
  const { monthlyTeamRotation } = await import('../src/monthly-team-rotation.mjs')
  const { suggestedVehicleAssignments } = await import('../src/vehicle-controls.mjs')
  const expandedTechnicians = [...technicians, { id: 'nuevo', name: 'Nuevo Técnico' }]
  const expandedVehicles = [...vehicles, { id: 'pickup', brand: 'Volkswagen', model: 'Saveiro', plate: 'AD444AD', mileage: 1000 }]
  const history = []
  const allResponsibles = new Set()
  const fordResponsibles = new Set()
  for (let monthNumber = 1; monthNumber <= 6; monthNumber += 1) {
    const month = `2026-${String(monthNumber).padStart(2, '0')}`
    const groups = monthlyTeamRotation(expandedTechnicians, month, '2026-01', expandedVehicles.length)
    const monthlyTeams = groups.map(members => ({ memberIds: members.map(technician => technician.id), members: members.map(technician => technician.name) }))
    const assignments = suggestedVehicleAssignments(expandedVehicles, monthlyTeams, { month, assignmentHistory: history })
    assert.equal(assignments.length, 4)
    assert.equal(new Set(assignments.map(assignment => assignment.technicianId)).size, 4)
    const soloIds = groups.filter(group => group.length === 1).map(group => group[0].id)
    const fordResponsible = assignments.find(assignment => assignment.vehicleId === 'ka').technicianId
    assert.ok(soloIds.includes(fordResponsible))
    fordResponsibles.add(fordResponsible)
    assignments.forEach(assignment => allResponsibles.add(assignment.technicianId))
    history.push(assignments)
  }
  assert.equal(allResponsibles.size, expandedTechnicians.length)
  assert.equal(fordResponsibles.size, expandedTechnicians.length)
})

test('genera controles determinísticos para los viernes futuros a las 15:30', async () => {
  const { buildVehicleControlRecords } = await import('../src/vehicle-controls.mjs')
  const assignments = [{ vehicleId: 'ka', technicianId: 'leonardo' }]
  const records = buildVehicleControlRecords({ month: '2026-09', assignments, vehicles, technicians, teams, fromDate: '2026-09-12' })
  assert.deepEqual(records.map(record => record.date), ['2026-09-18', '2026-09-25'])
  assert.ok(records.every(record => record.time === '15:30' && record.vehicleControl && record.technicianIds[0] === 'leonardo'))
  assert.equal(records[0].id, 'vehicle-control-2026-09-18-ka')
})

test('un control vehicular vencido bloquea domicilio y contacto de servicios posteriores', async () => {
  const { blockingOverdueVehicleControl, overdueVehicleControls } = await import('../src/technician-history.mjs')
  const records = [
    { id: 'control', date: '2026-09-04', time: '15:30', vehicleControl: true, vehicle: { brand: 'Ford', model: 'Ka' } },
    { id: 'sabado', date: '2026-09-05', time: '09:00' },
    { id: 'lunes', date: '2026-09-07', time: '09:00' }
  ]
  assert.deepEqual(overdueVehicleControls(records, '2026-09-05').map(record => record.id), ['control'])
  assert.equal(blockingOverdueVehicleControl(records, 1, '2026-09-05')?.id, 'control')
  assert.equal(blockingOverdueVehicleControl(records, 2, '2026-09-07')?.id, 'control')
})

test('un control vehicular completado no bloquea la agenda siguiente', async () => {
  const { blockingOverdueVehicleControl, overdueVehicleControls } = await import('../src/technician-history.mjs')
  const records = [
    { id: 'control', date: '2026-09-04', time: '15:30', vehicleControl: true, technicalStatus: 'Completado' },
    { id: 'lunes', date: '2026-09-07', time: '09:00' }
  ]
  assert.deepEqual(overdueVehicleControls(records, '2026-09-07'), [])
  assert.equal(blockingOverdueVehicleControl(records, 1, '2026-09-07'), null)
})

test('el servidor no permite omitir un control cancelándolo o reprogramándolo', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  for (const file of ['api/index.js', 'server.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.match(source, /record\.vehicleControl && type !== 'Completado'/)
  }
})
