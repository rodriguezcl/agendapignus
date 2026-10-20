const test = require('node:test')
const assert = require('node:assert/strict')
const load = () => import('../src/domain/dashboard/dashboard-notifications.mjs')
const today = '2026-10-13'
const now = Date.parse('2026-10-13T12:00:00Z') // 09:00 in Córdoba
const readPermissions = { dashboard: true, history: true, weekly: true, vehicles: true }
const granularUser = (enabled = [], overrides = {}) => ({
  id: 'reader', roleCode: 'custom', role: 'Rol de prueba',
  permissions: { __catalogV2: true, ...Object.fromEntries(enabled.map(key => [key, true])), ...overrides }
})
const noticeIds = notices => notices.map(notice => notice.id).sort()
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}
const operationalAccess = ['weekly.view', 'history.view', 'records.read']
const notificationFamilies = [
  ['notifications.collections', 'collection:collection'],
  ['notifications.reservations', 'reservation:reservation'],
  ['notifications.pendingToday', 'pending:today'],
  ['notifications.confirmation', 'pending:confirmation'],
  ['notifications.rescheduling', 'pending:rescheduling'],
  ['notifications.overdue', 'pending:overdue'],
  ['notifications.insurance', 'insurance:vehicle'],
  ['notifications.softguard', 'softguard-verification'],
  ['notifications.passwordRequests', 'password:reset']
]
const allFamilyPermissions = [
  ...operationalAccess, 'collections.view', 'records.financial',
  'vehicles.view', 'vehicle.insurance.read', 'accounts.view',
  'employees.view', 'employees.requests.read', 'records.contact'
]
function allFamilyState() {
  return {
    today: '2026-10-20', now: Date.parse('2026-10-20T12:00:00Z'),
    history: [
      { id: 'collection', date: '2026-10-19', status: 'Completado', client: 'Cliente cobrado', amount: '1000', paymentMethod: 'Efectivo' },
      { id: 'reservation', date: '2026-11-01', time: '08:30', client: 'Reserva visible', subscriberReservation: true, status: 'Pendiente', form: 'Completo', formEmail: 'reserva@example.test' },
      { id: 'today', date: '2026-10-20', status: 'Pendiente' },
      { id: 'confirmation', date: '2026-10-21', status: 'Pendiente', awaitingConfirmation: true },
      { id: 'rescheduling', date: '2026-10-20', status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada' },
      { id: 'overdue', date: '2026-10-19', status: 'Pendiente' }
    ],
    vehicles: [{ id: 'vehicle', brand: 'Ford', model: 'Ka', plate: 'ABC123', insuranceExpiresOn: '2026-10-19' }],
    customers: [{ customerId: 'pig', account: 'PIG-1000', name: 'Cliente' }, { customerId: 'cli', account: 'CLI-0001', name: 'Cliente', convertedFromAccount: 'PIG-1000' }],
    passwordResetRequests: [{ id: 'reset', email: 'solicitud@example.test' }]
  }
}

test('collection notices include today and earlier dates, become due across month/year boundaries and follow rescheduling', async () => {
  const { selectDashboardNotifications } = await load()
  const base = { amount: '10000', paymentMethod: 'Efectivo', status: 'Pendiente' }
  const history = [
    { ...base, id: 'past', date: '2026-12-30' },
    { ...base, id: 'today', date: '2026-12-31', time: '23:59' },
    { ...base, id: 'future', date: '2027-01-01' },
    { ...base, id: 'confirmed', date: '2026-12-30', collection: { status: 'confirmed' } },
    { ...base, id: 'corrected-future', date: '2027-01-01', collection: { status: 'pending' } },
    { ...base, id: 'before-rollout', date: '2026-10-13' }
  ]
  const snapshot = structuredClone(history)
  const ids = (date, records = history, access = { permissions: { collections: true } }) => selectDashboardNotifications({ history: records, today: date, ...access }).filter(item => item.target.type === 'collection').map(item => item.id).sort()
  assert.deepEqual(ids('2026-12-31'), ['collection:past', 'collection:today'])
  assert.deepEqual(ids('2026-12-31', history, { isAdministrator: true }), ['collection:past', 'collection:today'])
  assert.deepEqual(ids('2027-01-01'), ['collection:corrected-future', 'collection:future', 'collection:past', 'collection:today'])
  assert.deepEqual(ids('2026-12-31', history.map(record => record.id === 'today' ? { ...record, date: '2027-01-02' } : record)), ['collection:past'])
  assert.deepEqual(ids('2026-12-31', history, { permissions: { dashboard: true } }), [])
  assert.deepEqual(history, snapshot)
})

test('includes every existing dashboard notice family without modifying the snapshot', async () => {
  const { selectDashboardNotifications } = await load()
  const input = {
    today, now, isAdministrator: true,
    history: [
      { id: 'advance', date: today, time: '15:00', client: 'Cliente A', status: 'Pendiente', advanceRequest: { status: 'pending', requestedByName: 'Técnico' } },
      { id: 'reservation', date: '2026-10-30', time: '08:30', client: 'Reserva B', subscriberReservation: true, form: 'Completo', formEmail: ' cliente@example.com ', status: 'Pendiente' },
      { id: 'today', date: today, status: 'Pendiente' },
      { id: 'confirmation', date: '2026-10-14', status: 'Pendiente', awaitingConfirmation: true },
      { id: 'reschedule', date: today, status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada' },
      { id: 'overdue', date: '2026-10-12', status: 'Pendiente' }
    ],
    vehicles: [{ id: 'vehicle', brand: 'Ford', model: 'Ka', plate: 'ABC123', insuranceExpiresOn: '2026-10-12' }],
    passwordResetRequests: [{ id: 'reset', email: 'usuario@example.com' }],
    customers: [{ account: 'PIG-1000', name: 'Cliente' }, { account: 'CLI-0001', name: 'Cliente', convertedFromAccount: 'PIG-1000' }]
  }
  const before = JSON.stringify(input)
  const notices = selectDashboardNotifications(input)
  assert.deepEqual(notices.map(item => item.id), ['advance:advance', 'password:reset', 'insurance:vehicle', 'reservation:reservation', 'pending:today', 'pending:confirmation', 'pending:rescheduling', 'pending:overdue', 'softguard-verification'])
  assert.equal(new Set(notices.map(item => item.id)).size, notices.length)
  assert.match(notices.find(item => item.id === 'reservation:reservation').detail, /Formulario completo.*cliente@example\.com/)
  assert.deepEqual(notices.find(item => item.id === 'pending:today').target, { type: 'history', pendingGroup: 'today', date: today })
  assert.deepEqual(notices.find(item => item.id === 'insurance:vehicle').target, { type: 'vehicle', vehicleId: 'vehicle', edit: true })
  assert.equal(JSON.stringify(input), before)
})

test('operational notices follow module access instead of dashboard visibility and keep requests protected', async () => {
  const { selectDashboardNotifications } = await load()
  const state = {
    today, now,
    history: [{ id: 'r', date: today, client: 'Reserva', subscriberReservation: true, status: 'Pendiente', time: '15:00', advanceRequest: { status: 'pending' } }],
    vehicles: [{ id: 'v', insuranceExpiresOn: '2026-10-01' }],
    passwordResetRequests: [{ id: 'p', email: 'privado@example.com' }]
  }
  assert.deepEqual(selectDashboardNotifications(state), [])
  const operational = selectDashboardNotifications({ ...state, permissions: { weekly: true, history: true } })
  assert.deepEqual(noticeIds(operational), ['pending:today', 'reservation:r'])
  const limited = selectDashboardNotifications({ ...state, permissions: { dashboard: true } })
  assert.deepEqual(limited, [])
  const reader = selectDashboardNotifications({ ...state, permissions: readPermissions })
  assert.equal(reader.find(item => item.id === 'reservation:r').target.type, 'reservation')
  assert.deepEqual(reader.find(item => item.id === 'insurance:v').target, { type: 'vehicle', vehicleId: 'v', edit: false })
})

test('reservations retain ready-form rule, tomorrow boundary and chronological order across month changes', async () => {
  const { dashboardReservationRecords } = await load()
  const base = { subscriberReservation: true, status: 'Pendiente' }
  const records = [
    { ...base, id: 'late', date: '2026-11-01', time: '15:00' },
    { ...base, id: 'ready', date: '2026-12-01', form: 'Completo', formEmail: 'listo@example.com' },
    { ...base, id: 'too-far', date: '2026-11-02' },
    { ...base, id: 'early', date: '2026-11-01', time: '08:30' },
    { ...base, id: 'past', date: '2026-10-01' },
    { ...base, id: 'done', date: '2026-10-01', status: 'Completado' },
    { ...base, id: 'canceled', date: '2026-10-01', status: 'Cancelado' }
  ]
  assert.deepEqual(dashboardReservationRecords(records, '2026-10-31').map(item => item.id), ['past', 'early', 'late', 'ready'])
})

test('resolved notices disappear and insurance expires only after its expiry date', async () => {
  const { selectDashboardNotifications, dashboardExpiredInsuranceVehicles } = await load()
  const vehicles = [{ id: 'old', insuranceExpiresOn: '2026-10-12' }, { id: 'today', insuranceExpiresOn: today }, { id: 'new', insuranceExpiresOn: '2026-10-14' }, { id: 'missing' }]
  assert.deepEqual(dashboardExpiredInsuranceVehicles(vehicles, today).map(item => item.id), ['old'])
  const history = ['Completado', 'Cancelado', 'Avance registrado'].map((status, id) => ({ id, date: today, status }))
  assert.deepEqual(selectDashboardNotifications({ today, now, permissions: readPermissions, vehicles: vehicles.slice(1), history }), [])
})

test('advance request notice uses supplied instant, not the machine clock, and expires at service time', async () => {
  const { selectDashboardNotifications } = await load()
  const input = { today, isAdministrator: true, history: [{ id: 'advance', date: today, time: '15:00', status: 'Pendiente', advanceRequest: { status: 'pending' } }] }
  const advances = instant => selectDashboardNotifications({ ...input, now: instant }).filter(item => item.target.type === 'advance-request')
  assert.equal(advances(Date.parse('2026-10-13T17:59:00Z')).length, 1)
  assert.equal(advances(Date.parse('2026-10-13T18:00:00Z')).length, 0)
  assert.equal(advances(undefined).length, 0)
})

test('delegated password request readers see notices without gaining administrative actions', async () => {
  const { selectDashboardNotifications } = await load()
  const input = { today, now, passwordResetRequests: [{ id: 'delegated', email: 'solicitud@example.test' }], history: [{ id: 'advance', date: today, time: '15:00', advanceRequest: { status: 'pending' } }] }
  const notices = selectDashboardNotifications({ ...input, user: granularUser(['employees.view', 'employees.requests.read']) })
  assert.deepEqual(notices.map(notice => notice.id), ['password:delegated'])
  assert.equal(notices.some(notice => notice.target.type === 'advance-request'), false)
  assert.equal(selectDashboardNotifications({ ...input, permissions: { dashboard: true } }).some(notice => notice.target.type === 'password-reset'), false)
})

test('existing granular roles inherit only eligible notice families until explicitly configured', async () => {
  const { selectDashboardNotifications } = await load()
  const state = allFamilyState()
  const user = granularUser(allFamilyPermissions)
  const before = structuredClone({ state, user })
  const notices = selectDashboardNotifications({ ...state, user })
  assert.deepEqual(noticeIds(notices), notificationFamilies.map(([, id]) => id).sort())
  assert.deepEqual({ state, user }, before)
  assert.equal(user.permissions['notifications.collections'], undefined)
  assert.equal(user.permissions['dashboard.view'], undefined)
})

test('each notification switch independently silences its family without removing other eligible notices', async () => {
  const { selectDashboardNotifications } = await load()
  for (const [permission, disabledId] of notificationFamilies) {
    const notices = selectDashboardNotifications({
      ...allFamilyState(),
      user: granularUser(allFamilyPermissions, { [permission]: false })
    })
    assert.deepEqual(noticeIds(notices), notificationFamilies.map(([, id]) => id).filter(id => id !== disabledId).sort(), permission)
  }
})

test('enabling a notice never bypasses its revoked parent permissions', async () => {
  const { selectDashboardNotifications } = await load()
  const cases = [
    ['notifications.collections', 'records.financial', 'collection:collection'],
    ['notifications.collections', 'collections.view', 'collection:collection'],
    ['notifications.reservations', 'records.read', 'reservation:reservation'],
    ['notifications.pendingToday', 'records.read', 'pending:today'],
    ['notifications.confirmation', 'records.read', 'pending:confirmation'],
    ['notifications.rescheduling', 'records.read', 'pending:rescheduling'],
    ['notifications.overdue', 'records.read', 'pending:overdue'],
    ['notifications.insurance', 'vehicle.insurance.read', 'insurance:vehicle'],
    ['notifications.insurance', 'vehicles.view', 'insurance:vehicle'],
    ['notifications.softguard', 'accounts.view', 'softguard-verification'],
    ['notifications.passwordRequests', 'employees.requests.read', 'password:reset']
  ]
  for (const [permission, parent, deniedId] of cases) {
    const notices = selectDashboardNotifications({
      ...allFamilyState(),
      user: granularUser([...allFamilyPermissions, permission], { [parent]: false })
    })
    assert.equal(notices.some(notice => notice.id === deniedId), false, `${permission} must require ${parent}`)
  }
  const dashboardOnly = granularUser(['dashboard.view', 'records.read', ...notificationFamilies.map(([key]) => key)])
  assert.deepEqual(selectDashboardNotifications({ ...allFamilyState(), user: dashboardOnly }), [])
})

test('administrator retains every notification even when stored notification switches are false', async () => {
  const { selectDashboardNotifications } = await load()
  const user = {
    ...granularUser([], Object.fromEntries(notificationFamilies.map(([key]) => [key, false]))),
    roleCode: 'administrator', role: 'Administrador'
  }
  assert.deepEqual(noticeIds(selectDashboardNotifications({ ...allFamilyState(), user })), notificationFamilies.map(([, id]) => id).sort())
})

test('assigned scope filters services before individual notices and grouped counts are built', async () => {
  const { selectDashboardNotifications } = await load()
  const user = granularUser([...operationalAccess, 'collections.view', 'records.financial', 'records.contact'], { 'scope.services.read.assigned': true })
  const state = allFamilyState()
  const own = state.history.map(record => ({ ...record, id: `own-${record.id}`, technicianIds: ['reader'] }))
  const other = state.history.map(record => ({ ...record, id: `other-${record.id}`, client: 'Dato ajeno', technicianIds: ['other'] }))
  const input = deepFreeze({ ...state, user, history: [...own, ...other] })
  const before = JSON.stringify(input)
  const notices = selectDashboardNotifications(input)
  assert.deepEqual(noticeIds(notices), [
    'collection:own-collection', 'pending:confirmation', 'pending:overdue', 'pending:rescheduling', 'pending:today', 'reservation:own-reservation'
  ])
  assert.equal(notices.filter(notice => notice.id.startsWith('pending:')).every(notice => /: 1 servicio\(s\)$/.test(notice.title)), true)
  assert.doesNotMatch(JSON.stringify(notices), /other-|Dato ajeno/)
  assert.equal(JSON.stringify(input), before)
})

test('CCTV scope filters notices and grouped totals using customer identity and server visibility flags', async () => {
  const { selectDashboardNotifications } = await load()
  const user = granularUser(operationalAccess, { 'scope.services.read.cctv': true })
  const history = [
    { id: 'cctv', customerId: 'cctv-client', date: today, status: 'Pendiente', subscriberReservation: true },
    { id: 'regular', customerId: 'regular-client', date: today, status: 'Pendiente', subscriberReservation: true },
    { id: 'projected', customerId: 'not-in-client-list', supervisorVisible: true, date: today, status: 'Pendiente' },
    { id: 'unknown', customerId: 'not-in-client-list', date: today, status: 'Pendiente' }
  ]
  const customers = [{ customerId: 'cctv-client', cctvService: true }, { customerId: 'regular-client', cctvService: false }]
  const notices = selectDashboardNotifications({ today, user, history, customers })
  assert.deepEqual(noticeIds(notices), ['pending:today', 'reservation:cctv'])
  assert.match(notices.find(notice => notice.id === 'pending:today').title, /: 2 servicio\(s\)$/)
})

test('reservation notices omit contact and commercial form details unless both are authorized', async () => {
  const { selectDashboardNotifications } = await load()
  const state = {
    today,
    history: [{ id: 'private-form', subscriberReservation: true, status: 'Pendiente', date: today, form: 'Completo', formEmail: 'privado@example.test', amount: '910000', paymentMethod: 'Transferencia' }]
  }
  const noticesFor = permissions => selectDashboardNotifications({ ...state, user: granularUser(permissions) })
  for (const permissions of [operationalAccess, [...operationalAccess, 'records.financial'], [...operationalAccess, 'records.contact']]) {
    const notices = noticesFor(permissions)
    assert.ok(notices.some(notice => notice.id === 'reservation:private-form'))
    assert.doesNotMatch(JSON.stringify(notices), /privado@example\.test|910000|Formulario completo/)
  }
  const authorized = noticesFor([...operationalAccess, 'records.contact', 'records.financial'])
  assert.match(authorized.find(notice => notice.id === 'reservation:private-form').detail, /Formulario completo.*privado@example\.test/)
})

test('roles without financial access cannot receive amount-bearing collections even with stale unredacted data', async () => {
  const { selectDashboardNotifications } = await load()
  const state = allFamilyState()
  const user = granularUser(['collections.view', 'notifications.collections'])
  const notices = selectDashboardNotifications({ ...state, user })
  assert.deepEqual(notices, [])
})

test('a changed role immediately removes notices from the same previously received state', async () => {
  const { selectDashboardNotifications } = await load()
  const user = granularUser(['collections.view', 'records.financial'])
  const state = allFamilyState()
  assert.deepEqual(noticeIds(selectDashboardNotifications({ ...state, user })), ['collection:collection'])
  user.permissions['notifications.collections'] = false
  assert.deepEqual(selectDashboardNotifications({ ...state, user }), [])
  user.permissions['notifications.collections'] = true
  user.permissions['records.financial'] = false
  assert.deepEqual(selectDashboardNotifications({ ...state, user }), [])
})

test('dashboard metric-only projection never becomes an operational notification source', async () => {
  const { selectDashboardNotifications } = await load()
  const { visibleStateForUser } = require('../api/_lib/core.cjs')
  const state = { ...allFamilyState(), roles: [], employees: [], services: [], agenda: { teams: [], weekly: {} }, preferences: {} }
  const user = granularUser(['dashboard.view'])
  const visible = visibleStateForUser(state, user)
  assert.ok(visible.history.length > 0)
  assert.equal(visible.history.some(record => record.client || record.amount || record.formEmail), false)
  assert.deepEqual(selectDashboardNotifications({ ...visible, today: state.today, now: state.now, user }), [])
})

test('SoftGuard notices and modal customers are revalidated when customer scope narrows over an old snapshot', async () => {
  const { selectDashboardNotifications, visibleNotificationCustomers } = await load()
  const customers = [
    { customerId: 'pig-visible', account: 'PIG-1000', name: 'Cliente permitido', cctvService: true },
    { customerId: 'cli-visible', account: 'CLI-0001', name: 'Cliente permitido', convertedFromAccount: 'PIG-1000', cctvService: true },
    { customerId: 'pig-hidden', account: 'PIG-2000', name: 'Cliente ajeno', cctvService: false },
    { customerId: 'cli-hidden', account: 'CLI-0002', name: 'Cliente ajeno', convertedFromAccount: 'PIG-2000', cctvService: false }
  ]
  const history = [
    { id: 'assigned-by-id', customerId: 'pig-visible', technicianIds: ['reader'] },
    { id: 'assigned-by-account', clientAccount: 'CLI-0001', technicianIds: ['reader'] },
    { id: 'other-technician', customerId: 'pig-hidden', technicianIds: ['other'] }
  ]
  const before = structuredClone({ customers, history })
  const user = granularUser(['accounts.view'])
  assert.match(selectDashboardNotifications({ today, customers, history, user })[0].title, /: 2 cuenta\(s\)$/)
  for (const scope of ['cctv', 'related']) {
    user.permissions = { __catalogV2: true, 'accounts.view': true, [`scope.customers.read.${scope}`]: true }
    const notices = selectDashboardNotifications({ today, customers, history, user })
    assert.deepEqual(noticeIds(notices), ['softguard-verification'])
    assert.match(notices[0].title, /: 1 cuenta\(s\)$/)
    assert.deepEqual(visibleNotificationCustomers(customers, history, user).map(customer => customer.customerId), ['pig-visible', 'cli-visible'])
  }
  user.permissions['scope.customers.read.cctv'] = true
  assert.deepEqual(selectDashboardNotifications({ today, customers, history, user }), [])
  assert.deepEqual(visibleNotificationCustomers(customers, history, user), [])
  assert.deepEqual({ customers, history }, before)
})

test('contradictory account text cannot override a valid customer identity when filtering notifications', async () => {
  const { selectDashboardNotifications, visibleNotificationCustomers } = await load()
  const customers = deepFreeze([
    { customerId: 'allowed', account: 'PIG-1000', name: 'Cuenta CCTV', cctvService: true },
    { customerId: 'denied', account: 'PIG-2000', name: 'Cuenta común', cctvService: false }
  ])
  const conflicting = {
    id: 'conflict', customerId: 'denied', clientAccount: 'PIG-1000',
    subscriberReservation: true, status: 'Pendiente', date: today,
    supervisorVisible: true, technicianIds: ['reader']
  }
  const cctvUser = granularUser(operationalAccess, { 'scope.services.read.cctv': true })
  assert.deepEqual(selectDashboardNotifications({ today, customers, history: [conflicting], user: cctvUser }), [])
  const relatedUser = granularUser(['accounts.view'], { 'scope.customers.read.related': true })
  assert.deepEqual(visibleNotificationCustomers(customers, [conflicting], relatedUser).map(customer => customer.customerId), ['denied'])

  const missingIdentity = { ...conflicting, id: 'fallback', customerId: 'removed-customer' }
  const notices = selectDashboardNotifications({ today, customers, history: [missingIdentity], user: cctvUser })
  assert.deepEqual(noticeIds(notices), ['pending:today', 'reservation:fallback'])
  assert.deepEqual(visibleNotificationCustomers(customers, [missingIdentity], relatedUser).map(customer => customer.customerId), ['allowed'])
})
