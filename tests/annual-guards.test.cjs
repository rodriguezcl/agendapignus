const test = require('node:test')
const assert = require('node:assert/strict')

const rotation = [
  { technicianId: 'rodrigo', name: 'Rodrigo Gonzalez' },
  { technicianId: 'pascual', name: 'Pascual Gonzalez' },
  { technicianId: 'santos', name: 'Santos Diaz' },
  { technicianId: 'mariano', name: 'Mariano Diaz Tillard' },
  { technicianId: 'leonardo', name: 'Leonardo Rivadero' }
]

test('replica durante 2026 el orden de guardias entregado por Administración', async () => {
  const { annualGuardForDate, firstSaturdayOfYear } = await import('../src/annual-guards.mjs')
  const weekly = { _annualGuards: { 2026: { startDate: firstSaturdayOfYear(2026), rotation } } }

  assert.equal(firstSaturdayOfYear(2026), '2026-01-03')
  assert.equal(annualGuardForDate('2026-03-14', weekly).technicianId, 'rodrigo')
  assert.equal(annualGuardForDate('2026-03-21', weekly).technicianId, 'pascual')
  assert.equal(annualGuardForDate('2026-03-28', weekly).technicianId, 'santos')
  assert.equal(annualGuardForDate('2026-04-04', weekly).technicianId, 'mariano')
  assert.equal(annualGuardForDate('2026-04-11', weekly).technicianId, 'leonardo')
  assert.equal(annualGuardForDate('2026-08-29', weekly).technicianId, 'leonardo')
  assert.equal(annualGuardForDate('2026-09-05', weekly).technicianId, 'rodrigo')
  assert.equal(annualGuardForDate('2026-12-26', weekly).technicianId, 'pascual')
})

test('la configuración anual admite otro orden y no asigna días que no sean sábado', async () => {
  const { annualGuardForDate } = await import('../src/annual-guards.mjs')
  const weekly = { _annualGuards: { 2027: { startDate: '2027-01-02', rotation: [rotation[2], rotation[0]] } } }

  assert.equal(annualGuardForDate('2027-01-02', weekly).technicianId, 'santos')
  assert.equal(annualGuardForDate('2027-01-09', weekly).technicianId, 'rodrigo')
  assert.equal(annualGuardForDate('2027-01-04', weekly), null)
})

const technicians = () => [
  ...rotation.map(entry => ({ id: entry.technicianId, name: entry.name, status: 'Activo', roleCode: 'technician' })),
  { id: 'new', name: 'Ana Nueva', status: 'Activo', roleCode: 'technician' },
  { id: 'helper', name: 'Agente con función técnica', status: 'Activo', roleCode: 'user', technicalEnabled: true }
]

test('la propuesta anual incorpora al nuevo técnico aunque un integrante original esté inactivo', async () => {
  const { defaultAnnualGuardRotation } = await import('../src/annual-guards.mjs')
  const employees = technicians().map(employee => employee.id === 'leonardo' ? { ...employee, status: 'Inactivo' } : employee)
  assert.deepEqual(defaultAnnualGuardRotation(employees).map(entry => entry.technicianId), ['rodrigo', 'pascual', 'santos', 'mariano', 'new'])
})

test('un año todavía no configurado conserva el orden previo y completa las incorporaciones activas', async () => {
  const { suggestedAnnualGuardRotation } = await import('../src/annual-guards.mjs')
  const weekly = { _annualGuards: { 2026: { rotation: [rotation[2], rotation[0], rotation[4]] } } }
  const original = structuredClone(weekly)
  const employees = technicians().map(employee => employee.id === 'leonardo' ? { ...employee, status: 'Inactivo' } : employee)
  assert.deepEqual(suggestedAnnualGuardRotation('2028', weekly, employees).map(entry => entry.technicianId), ['santos', 'rodrigo', 'pascual', 'mariano', 'new'])
  assert.deepEqual(weekly, original)
})

test('las sugerencias respetan los años guardados, incluso una rotación vacía', async () => {
  const { suggestedAnnualGuardRotation } = await import('../src/annual-guards.mjs')
  const weekly = { _annualGuards: { 2026: { rotation: [rotation[2], rotation[0]] }, 2027: { rotation: [] } } }
  const suggested = suggestedAnnualGuardRotation('2026', weekly, technicians())
  assert.deepEqual(suggested, weekly._annualGuards[2026].rotation)
  suggested[0].name = 'Un borrador no modifica lo guardado'
  assert.equal(weekly._annualGuards[2026].rotation[0].name, 'Santos Diaz')
  assert.deepEqual(suggestedAnnualGuardRotation('2027', weekly, technicians()), [])
})

test('la incorporación no cambia guardias pasadas implícitas ni configuradas', async () => {
  const { guardForDateWithDefaults } = await import('../src/features/agenda/application/agenda-model.mjs')
  const originalEmployees = technicians().filter(employee => employee.id !== 'new')
  const weekly = { _annualGuards: { 2026: { startDate: '2026-01-03', rotation } } }
  for (const day of ['2026-03-14', '2026-04-11', '2026-09-05']) {
    assert.deepEqual(guardForDateWithDefaults(day, {}, technicians(), '2026-10-01'), guardForDateWithDefaults(day, {}, originalEmployees, '2026-10-01'))
    assert.deepEqual(guardForDateWithDefaults(day, weekly, technicians(), '2026-10-01'), guardForDateWithDefaults(day, weekly, originalEmployees, '2026-10-01'))
  }
})

test('sin año configurado la agenda incluye nuevos técnicos en los sábados futuros', async () => {
  const { guardForDateWithDefaults } = await import('../src/features/agenda/application/agenda-model.mjs')
  assert.equal(guardForDateWithDefaults('2026-10-03', {}, technicians(), '2026-10-01').technicianId, 'mariano')
  assert.equal(guardForDateWithDefaults('2026-11-28', {}, technicians(), '2026-10-01').technicianId, 'new')
  assert.equal(guardForDateWithDefaults('2026-11-28', { _annualGuards: { 2026: { rotation: [] } } }, technicians(), '2026-10-01'), null)
})

test('una incorporación en sábado comienza su nueva rotación el sábado siguiente', async () => {
  const { nextSaturdayAfter } = await import('../src/annual-guards.mjs')
  assert.equal(nextSaturdayAfter('2026-10-01'), '2026-10-03')
  assert.equal(nextSaturdayAfter('2026-10-03'), '2026-10-10')
  assert.equal(nextSaturdayAfter('2026-12-26'), '2027-01-02')
})

test('la propuesta conserva al ingresante y lo incorpora a guardias solamente después de 60 días', async () => {
  const { suggestedAnnualGuardRotation, annualGuardForDate } = await import('../src/annual-guards.mjs')
  const employees = [
    { id: 'a', name: 'Técnico A', status: 'Activo', roleCode: 'technician' },
    { id: 'b', name: 'Técnico B', status: 'Activo', roleCode: 'technician' },
    { id: 'new', name: 'Santiago Nuevo', status: 'Activo', roleCode: 'technician', employmentStartDate: '2026-11-25' }
  ]
  const proposed = suggestedAnnualGuardRotation('2026', {}, employees)
  assert.equal(proposed.find(entry => entry.technicianId === 'new').guardEligibleFrom, '2027-01-24')
  const weekly = { _annualGuards: { 2026: { startDate: '2026-11-28', rotation: proposed } } }
  for (const date of ['2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26']) assert.notEqual(annualGuardForDate(date, weekly).technicianId, 'new')
  weekly._annualGuards[2027] = { startDate: '2027-01-02', rotation: suggestedAnnualGuardRotation('2027', weekly, employees) }
  for (const date of ['2027-01-02', '2027-01-09', '2027-01-16', '2027-01-23']) assert.notEqual(annualGuardForDate(date, weekly).technicianId, 'new')
  assert.equal(annualGuardForDate('2027-01-30', weekly).technicianId, 'new')
})

test('la selección manual bloquea guardias prematuras y permite servicios ordinarios', async () => {
  const { guardAssignmentRestriction } = await import('../src/annual-guards.mjs')
  const technician = { id: 'new', name: 'Santiago Nuevo', employmentStartDate: '2026-11-25' }
  const ordinary = { teamId: 'ordinary', memberIds: ['a'], tasks: [{ serviceId: 'alarm', client: 'Cliente', time: '14:00', status: 'Pendiente' }] }
  const advance = { ...ordinary, teamId: 'friday-guard-2026-11-27-a', label: 'Guardia · Técnico A', tasks: [{ ...ordinary.tasks[0], time: '16:30' }] }
  assert.match(guardAssignmentRestriction(technician, '2026-11-28', ordinary), /24\/01\/2027/)
  assert.match(guardAssignmentRestriction(technician, '2026-11-27', advance), /60 días/)
  assert.equal(guardAssignmentRestriction(technician, '2026-11-27', ordinary), '')
  assert.equal(guardAssignmentRestriction(technician, '2026-11-26', ordinary), '')
  assert.equal(guardAssignmentRestriction(technician, '2027-01-30', ordinary), '')
  assert.equal(guardAssignmentRestriction({ id: 'legacy', name: 'Técnico anterior' }, '2026-11-28', ordinary), '')
})

test('un año futuro sin configurar conserva su rotación al avanzar hoy y habilita al ingresante a los 60 días', async () => {
  const { guardForDateWithDefaults } = await import('../src/features/agenda/application/agenda-model.mjs')
  const employees = technicians().map(employee => employee.id === 'new' ? { ...employee, employmentStartDate: '2026-11-25' } : employee)
  const dates = ['2027-01-02', '2027-01-09', '2027-01-16', '2027-01-23', '2027-01-30', '2027-02-06', '2027-02-13']
  const assignments = dates.map(date => guardForDateWithDefaults(date, {}, employees, '2026-11-25'))
  assert.ok(assignments.every(Boolean))
  assert.equal(assignments.slice(0, 4).some(entry => entry.technicianId === 'new'), false)
  assert.ok(assignments.slice(4).some(entry => entry.technicianId === 'new'))
  for (const date of dates.filter(value => value > '2027-01-15')) {
    assert.deepEqual(guardForDateWithDefaults(date, {}, employees, '2027-01-01'), guardForDateWithDefaults(date, {}, employees, '2027-01-15'))
  }
  assert.deepEqual(guardForDateWithDefaults('2027-01-30', {}, employees, '2027-01-30'), guardForDateWithDefaults('2027-01-30', {}, employees, '2027-01-15'))
  assert.notEqual(guardForDateWithDefaults('2027-01-23', {}, employees, '2027-01-23').technicianId, 'new')
  assert.equal(guardForDateWithDefaults('2027-01-23', {}, employees, '2027-01-30'), null)
  assert.equal(guardForDateWithDefaults('2027-02-06', { _annualGuards: { 2027: { rotation: [] } } }, employees, '2027-01-15'), null)
  assert.equal(guardForDateWithDefaults('2025-12-27', {}, employees, '2027-01-15'), null)
})
