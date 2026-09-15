const test = require('node:test')
const assert = require('node:assert/strict')
const { userCan, userForEmployee, visibleStateForUser } = require('../api/_lib/core.cjs')

const supervisor = { id: 'supervisor-1', roleCode: 'supervisor', role: 'Supervisor', permissions: { dashboard: true, historyManage: true, accounts: true } }

test('el tema de Supervisor es local y no dispara escrituras ni bloquea la actualización', () => {
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(app, /preferences: isSupervisor \? \{\} : \{ theme \}/)
  assert.match(app, /useEffect\(\(\) => writeLocalValue\('pignus-theme', theme\), \[theme\]\)/)
  assert.match(app, /if \(!isSupervisor && data.preferences\?\.theme\) setTheme/)
  assert.match(app, /if \(isSupervisor\) return\s+if \(confirmedSaveRef.current/)
  assert.match(app, /const hasLocalChanges = !isSupervisor &&/)
  assert.match(app, /const canPersistLatestSnapshot = !isSupervisor &&/)
})

test('Supervisor abre Historial desde el primer render, incluso con navegación previa a estadísticas', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(app, /const module = isSupervisor && requestedModule !== 'accounts' \? 'history' : requestedModule/)
  const { resolvedRolePermissions } = await import('../src/domain/access/permissions.mjs')
  const permissions = resolvedRolePermissions({ name: 'Supervisor', permissions: { dashboard: true, historyManage: true } })
  assert.equal(permissions.history, true)
  assert.equal(permissions.dashboard, false)
  assert.equal(permissions.historyManage, false)
  assert.equal(permissions.accounts, true)
  for (const permission of ['accountsEdit', 'accountsDelete', 'accountsImport']) assert.equal(permissions[permission], false)
})

const state = {
  revision: 17,
  roles: [{ id: 'role-supervisor', code: 'role-custom', name: 'Supervisor', permissions: { dashboard: true, historyManage: true } }],
  employees: [], services: [{ id: 'service-1' }], vehicles: [{ id: 'vehicle-1' }], preferences: { theme: 'dark' }, agenda: { teams: [] }, reviews: [],
  customers: [
    { customerId: 'customer-cctv', account: 'PIG-0100', name: 'CUENTA CCTV', cctvService: true },
    { customerId: 'customer-normal', account: 'CLI-0200', name: 'CUENTA NORMAL', cctvService: false }
  ],
  history: [
    { id: 'allowed-by-id', customerId: 'customer-cctv', client: 'PIG-0100 CUENTA CCTV', technicalStatus: 'Completado', technicalObservation: 'Se reemplazó la cámara', technicalReportedAt: '2026-09-15T12:00:00.000Z', internalNote: 'dato privado', amount: '$ 100.000', monthlyFee: '$ 5.000', paymentMethod: 'Efectivo', form: 'Alta' },
    { id: 'allowed-by-account', customerId: '', clientAccount: 'PIG-0100', client: 'Nombre histórico corregido', technicalObservation: 'Se ajustó el enfoque' },
    { id: 'denied', customerId: 'customer-normal', client: 'CLI-0200 CUENTA NORMAL', technicalObservation: 'No debe verse' }
  ]
}

test('Supervisor sólo recibe el historial de cuentas marcadas como Servicio de CCTV', () => {
  const visible = visibleStateForUser(state, supervisor)

  assert.equal(visible.revision, 17)
  assert.deepEqual(visible.history.map(record => record.id), ['allowed-by-id', 'allowed-by-account'])
  assert.equal(visible.history[0].technicalObservation, 'Se reemplazó la cámara')
  assert.equal('internalNote' in visible.history[0], false)
  assert.equal('amount' in visible.history[0], false)
  assert.equal('monthlyFee' in visible.history[0], false)
  assert.equal('paymentMethod' in visible.history[0], false)
  assert.equal('form' in visible.history[0], false)
  assert.deepEqual(visible.roles, [])
  assert.deepEqual(visible.employees, [])
  assert.deepEqual(visible.services, [])
  assert.deepEqual(visible.vehicles, [])
  assert.deepEqual(visible.customers.map(customer => customer.customerId), ['customer-cctv'])
  assert.deepEqual(visibleStateForUser({ ...state, customers: state.customers.map(customer => ({ ...customer, cctvService: false })) }, supervisor).customers, [])
  assert.equal(visible.agenda, null)
})

test('Supervisor tiene acceso de lectura al Historial y ningún permiso de gestión', () => {
  assert.equal(userCan(supervisor, 'history'), true)
  assert.equal(userCan(supervisor, 'historyManage'), false)
  assert.equal(userCan(supervisor, 'accounts'), true)
  for (const permission of ['accountsEdit', 'accountsDelete', 'accountsImport']) assert.equal(userCan({ ...supervisor, permissions: { [permission]: true } }, permission), false)
  assert.equal(userCan(supervisor, 'dashboard'), false)
})

test('un rol personalizado llamado Supervisor recibe el código protegido aunque tuviera un código genérico', () => {
  const user = userForEmployee({ id: 'employee-1', name: 'Ana', email: 'ana@example.com', roleId: 'role-supervisor' }, state.roles)
  assert.equal(user.roleCode, 'supervisor')
})
