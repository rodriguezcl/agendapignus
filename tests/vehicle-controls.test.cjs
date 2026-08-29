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
