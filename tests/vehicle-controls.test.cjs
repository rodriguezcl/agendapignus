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

test('adelanta el control al último día operativo cuando el viernes es feriado cerrado', async () => {
  const { buildVehicleControlRecords } = await import('../src/vehicle-controls.mjs')
  const assignments = [{ vehicleId: 'ka', technicianId: 'leonardo' }]
  const holidays = [
    { date: '2026-09-18', name: 'Feriado del viernes' },
    { date: '2026-09-17', name: 'Feriado puente' }
  ]
  const fridayClosed = buildVehicleControlRecords({
    month: '2026-09', assignments, vehicles, technicians, teams, fromDate: '2026-09-14', holidays,
    holidayOverrides: { '2026-09-18': { status: 'closed' }, '2026-09-17': { status: 'working' } }
  })
  assert.equal(fridayClosed[0].date, '2026-09-17')
  assert.equal(fridayClosed[0].vehicleControlScheduledFriday, '2026-09-18')
  assert.equal(fridayClosed[0].id, 'vehicle-control-2026-09-18-ka')

  const persistedDecision = buildVehicleControlRecords({
    month: '2026-09', assignments, vehicles, technicians, teams, fromDate: '2026-09-14',
    holidayOverrides: { '2026-09-18': { status: 'closed' } }
  })
  assert.equal(persistedDecision[0].date, '2026-09-17')

  const bridgeClosed = buildVehicleControlRecords({
    month: '2026-09', assignments, vehicles, technicians, teams, fromDate: '2026-09-14', holidays,
    holidayOverrides: { '2026-09-18': { status: 'closed' }, '2026-09-17': { status: 'closed' } }
  })
  assert.equal(bridgeClosed[0].date, '2026-09-16')
  assert.equal(bridgeClosed[0].id, 'vehicle-control-2026-09-18-ka')
})

test('reubica controles pendientes ya creados y conserva los completados', async () => {
  const { rescheduleVehicleControlRecords } = await import('../src/vehicle-controls.mjs')
  const holidays = [{ date: '2026-09-18' }, { date: '2026-09-17' }]
  const records = [
    { id: 'vehicle-control-2026-09-18-ka', date: '2026-09-18', vehicleControl: true, status: 'Pendiente' },
    { id: 'vehicle-control-2026-09-18-utilitario', date: '2026-09-18', vehicleControl: true, status: 'Completado', technicalStatus: 'Completado' }
  ]
  const moved = rescheduleVehicleControlRecords(records, { holidays, holidayOverrides: { '2026-09-18': { status: 'closed' }, '2026-09-17': { status: 'closed' } } })
  assert.equal(moved[0].date, '2026-09-16')
  assert.equal(moved[0].vehicleControlScheduledFriday, '2026-09-18')
  assert.strictEqual(moved[1], records[1])

  const restored = rescheduleVehicleControlRecords(moved, { holidays, holidayOverrides: { '2026-09-18': { status: 'working' }, '2026-09-17': { status: 'closed' } } })
  assert.equal(restored[0].date, '2026-09-18')
})

test('un control vehicular se habilita recién en su fecha y hora programadas de Argentina', async () => {
  const { vehicleControlIsOpen, vehicleControlScheduledAt, vehicleControlWindowLabel } = await import('../src/vehicle-control-window.mjs')
  const record = { date: '2026-09-04', time: '15:30', vehicleControl: true }
  assert.equal(vehicleControlScheduledAt(record).toISOString(), '2026-09-04T18:30:00.000Z')
  assert.equal(vehicleControlIsOpen(record, '2026-09-04T18:29:59.999Z'), false)
  assert.equal(vehicleControlIsOpen(record, '2026-09-04T18:30:00.000Z'), true)
  assert.match(vehicleControlWindowLabel(record), /viernes.*4.*septiembre.*2026.*15:30/i)
  assert.equal(vehicleControlIsOpen({ date: '2026-09-04', time: '15:30' }, '2026-09-01T00:00:00Z'), true)
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
    assert.match(source, /record\.vehicleControl && !vehicleControlIsOpen\(record\)/)
  }
})

test('el portal técnico deshabilita el control anticipado y muestra cuándo se habilita', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-polish.css'), 'utf8')
  assert.match(source, /const earlyVehicleControl = record\.vehicleControl && !vehicleControlIsOpen\(record, clock\)/)
  assert.match(source, /disabled=\{earlyVehicleControl \|\| !canComplete\}/)
  assert.match(source, /Este control se habilita el \{vehicleControlWindowLabel\(record\)\}/)
  assert.match(styles, /\.vehicle-control-early-notice/)
})

test('el control vehicular es autónomo y no muestra dirección, contacto ni avisos de desbloqueo', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  assert.match(source, /const unlocked = record\.vehicleControl \|\| view === 'history'/)
  assert.match(source, /\{record\.vehicleControl \? null : unlocked \? <>/)
  assert.match(source, /\{unlocked && !done && <>/)
  assert.match(source, /Los controles vehiculares son tareas autónomas/)
})

test('la captura vehicular admite imágenes del teléfono y solicita la cámara trasera', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  assert.match(source, /photoInput\.accept = 'image\/\*'/)
  assert.match(source, /photoInput\.setAttribute\('capture', 'environment'\)/)
})

test('el portal técnico evita selectores incompatibles y muestra una recuperación ante errores', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const portal = source.slice(source.indexOf('function TechnicianPortal('), source.indexOf('function DashboardStatusView('))
  assert.doesNotMatch(portal, /:scope/)
  assert.match(source, /class TechnicianPortalErrorBoundary extends React\.Component/)
  assert.match(source, /No pudimos mostrar tus servicios/)
  assert.match(source, /authUser\.roleCode === 'technician'/)
  assert.match(source, /else media\.addListener\(syncSidebarMode\)/)
})
