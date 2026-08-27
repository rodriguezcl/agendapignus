const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  authorizeIncomingState, compareReportRecords, hashPassword, normalizeRetirementCustomers, normalizeStateForSave,
  secureEmployees, statePersistenceChanged, userForEmployee, verifyPassword, visibleStateForUser
} = require('../api/_lib/core.cjs')

const roles = [
  { id: '1', code: 'administrator', name: 'Administrador', permissions: {} },
  { id: '3', code: 'technician', name: 'Técnico', permissions: {} },
  { id: '4', code: 'viewer', name: 'Consulta', permissions: { history: true } }
]

const employee = { id: 'e1', firstName: 'Ana', lastName: 'Técnica', name: 'Ana Técnica', email: 'ana@example.com', roleId: '3', role: 'Técnico', status: 'Activo' }

test('el buscador del historial técnico contempla todos los datos útiles', async () => {
  const { filterTechnicianHistory } = await import('../src/technician-history.mjs')
  const records = [
    { id: 'a', client: 'PIG-6425 LORENA MAZZAGLIA', service: 'Service de alarma', detail: 'Falsos disparos por humedad', address: 'Docta', phone: '351152022189', date: '2026-08-26', status: 'Completado' },
    { id: 'b', client: 'CLI-0093 OTRO CLIENTE', service: 'Instalación de cámaras', detail: 'Cambio de equipos', date: '2026-01-02', status: 'Cancelado' }
  ]

  for (const query of ['lorena', 'PIG-6425', 'alarma humedad', 'docta', '351152022189', '26 agosto 2026', 'completado']) {
    assert.deepEqual(filterTechnicianHistory(records, query).map(record => record.id), ['a'])
  }
  assert.deepEqual(filterTechnicianHistory(records, 'camaras cancelado').map(record => record.id), ['b'])
  assert.deepEqual(filterTechnicianHistory(records, 'registro inexistente'), [])
})

test('el técnico usa el mismo menú móvil desplegable que los demás roles', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/style.css'), 'utf8')
  assert.match(source, /sidebar technician-sidebar/)
  assert.match(source, /technician-mobile-menu/)
  assert.match(source, /setMenuOpen\(true\)/)
  assert.match(source, /backdrop/)
  assert.match(styles, /@media\(max-width:640px\)\{\.technician-sidebar\{display:flex;z-index:8\}/)
})

test('el control para compactar la barra lateral no se activa en smartphones', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  assert.match(source, /matchMedia\?\.\('\(min-width: 641px\)'\)/)
  assert.match(source, /classList\.toggle\('sidebar-collapsed', desktopSidebar && sidebarCollapsed\)/)
  assert.match(source, /if \(!desktopSidebar\) return undefined/)
  assert.doesNotMatch(source, /zIndex: '20', display: 'grid'/)
  assert.match(styles, /\.sidebar-collapse-toggle \{\s*display: none !important;/)
  assert.match(styles, /\.sidebar\.sidebar-compact nav button::after \{\s*display: none;\s*content: none;/)
})

test('la evolución anual oculta meses futuros y conserva años cerrados', async () => {
  const { visibleAnnualMonthLabels } = await import('../src/annual-chart.mjs')
  const august2026 = new Date(2026, 7, 26, 12)
  assert.deepEqual(visibleAnnualMonthLabels('2026', august2026), ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago'])
  assert.equal(visibleAnnualMonthLabels('2025', august2026).length, 12)
  assert.deepEqual(visibleAnnualMonthLabels('2027', august2026), [])
})

test('configura formulario, forma de pago y monto según el servicio', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /PAYMENT_OPTIONS = \['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'A confirmar'\]/)
  assert.match(source, /form: alarmInstallation \|\| ownershipChange/)
  assert.match(source, /paymentMethod !== 'A confirmar'/)
  assert.match(source, /if \(key === 'amount' && !enabled\) return null/)
  assert.match(source, /amount: paymentMethod \? task\?\.amount \|\| '' : ''/)
  assert.match(source, /requiresPaymentAmount\(task, serviceForTask\(task\)\)/)
  assert.match(source, /requiresPaymentAmount\(draft, serviceForWeeklyTask\(draft\)\)/)
})

test('genera y verifica hashes compatibles con las credenciales existentes', () => {
  const hash = hashPassword('Prueba1234')
  assert.equal(verifyPassword('Prueba1234', hash), true)
  assert.equal(verifyPassword('Incorrecta123', hash), false)
})

test('resuelve el rol y limita el estado visible del técnico', () => {
  const user = userForEmployee(employee, roles)
  const state = { revision: 4, roles, employees: [employee], services: [], customers: [], agenda: {}, preferences: {}, history: [{ id: 'a', technicianIds: ['e1'] }, { id: 'b', technicianIds: ['e2'] }] }
  const visible = visibleStateForUser(state, user)
  assert.deepEqual(visible.history.map(record => record.id), ['a'])
  assert.equal(visible.agenda, null)
  assert.deepEqual(visible.customers, [])
})

test('ignora roles nulos al resolver una sesión', () => {
  const user = userForEmployee(employee, [null, undefined, ...roles])
  assert.equal(user.id, employee.id)
  assert.equal(user.roleCode, 'technician')
  assert.equal(userForEmployee(employee, [null]), null)
})

test('dos sesiones simultáneas no crean revisiones al guardar el mismo estado', () => {
  const current = { roles, employees: [employee], services: [], customers: [], history: [], reviews: [], agenda: { date: '2026-08-25', teams: [], weekly: {} }, preferences: { theme: 'light' } }
  let revision = 12
  const save = (sessionRevision, next) => {
    if (!statePersistenceChanged(current, next)) return revision
    if (sessionRevision !== revision) throw new Error('conflict')
    revision += 1
    return revision
  }

  assert.equal(save(12, structuredClone(current)), 12)
  assert.equal(save(12, structuredClone(current)), 12)
  assert.equal(save(12, { ...structuredClone(current), preferences: { theme: 'light' }, agenda: { weekly: {}, teams: [], date: '2026-08-25' } }), 12)
  assert.equal(revision, 12)
  assert.equal(statePersistenceChanged(current, { ...current, agenda: { ...current.agenda, date: '2026-08-26' } }), true)
})

test('impide que un rol de consulta modifique colecciones sin permiso', () => {
  const user = userForEmployee({ ...employee, roleId: '4', role: 'Consulta' }, roles)
  const current = { roles, employees: [employee], services: [{ id: 1 }], customers: [{ account: 'CLI-1' }], history: [{ id: 'old' }], reviews: [], agenda: { date: '2026-01-01', teams: [], weekly: {} } }
  const incoming = { ...current, services: [], customers: [], history: [], agenda: { date: '2030-01-01', teams: [{ teamId: 'x' }], weekly: {} } }
  const authorized = authorizeIncomingState(incoming, current, user)
  assert.deepEqual(authorized.services, current.services)
  assert.deepEqual(authorized.customers, current.customers)
  assert.deepEqual(authorized.agenda, current.agenda)
})

test('conserva el hash al editar un empleado sin cambiar su contraseña', () => {
  const passwordHash = hashPassword('Prueba1234')
  const current = [{ ...employee, passwordHash }]
  const normalized = normalizeStateForSave({ roles, employees: [{ ...employee, lastName: 'Actualizada' }], services: [], customers: [], history: [], reviews: [], agenda: {} }, { reviews: [] })
  const secured = secureEmployees(normalized.employees, current)
  assert.equal(secured[0].passwordHash, passwordHash)
  assert.equal(secured[0].name, 'Ana Actualizada')
})

test('ordena reportes desde la fecha más reciente y por hora dentro del día', () => {
  const records = [
    { id: 'old', date: '2026-01-01', time: '08:00' },
    { id: 'late', date: '2026-01-03', time: '15:00' },
    { id: 'early', date: '2026-01-03', time: '08:00' }
  ].sort(compareReportRecords)
  assert.deepEqual(records.map(record => record.id), ['early', 'late', 'old'])
})

test('convierte el abonado y todas sus referencias al completar una baja', () => {
  const state = {
    customers: [{ customerId: 'c1', account: 'PIG-001', name: 'CLIENTE', kind: 'subscriber' }],
    history: [{ id: 'h1', customerId: 'c1', clientAccount: 'PIG-001', service: 'Retiro de equipo de alarma', status: 'Completado' }],
    reviews: [],
    agenda: { teams: [{ tasks: [{ customerId: 'c1', clientAccount: 'PIG-001' }] }], weekly: {} }
  }
  const result = normalizeRetirementCustomers(state)
  assert.equal(result.conversions.length, 1)
  assert.equal(result.state.customers[0].account, 'CLI-0001')
  assert.equal(result.state.history[0].clientAccount, 'CLI-0001')
  assert.equal(result.state.agenda.teams[0].tasks[0].clientAccount, 'CLI-0001')
})
