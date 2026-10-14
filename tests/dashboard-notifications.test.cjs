const test = require('node:test')
const assert = require('node:assert/strict')
const load = () => import('../src/domain/dashboard/dashboard-notifications.mjs')
const today = '2026-10-13'
const now = Date.parse('2026-10-13T12:00:00Z') // 09:00 in Córdoba
const readPermissions = { dashboard: true, history: true, weekly: true, vehicles: true }

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

test('enforces dashboard visibility and admin-only requests with navigation permission fallbacks', async () => {
  const { selectDashboardNotifications } = await load()
  const state = {
    today, now,
    history: [{ id: 'r', date: today, client: 'Reserva', subscriberReservation: true, status: 'Pendiente', time: '15:00', advanceRequest: { status: 'pending' } }],
    vehicles: [{ id: 'v', insuranceExpiresOn: '2026-10-01' }],
    passwordResetRequests: [{ id: 'p', email: 'privado@example.com' }]
  }
  assert.deepEqual(selectDashboardNotifications(state), [])
  assert.deepEqual(selectDashboardNotifications({ ...state, permissions: { weekly: true, history: true } }), [])
  const limited = selectDashboardNotifications({ ...state, permissions: { dashboard: true } })
  assert.equal(limited.some(item => item.id.startsWith('advance:') || item.id.startsWith('password:')), false)
  assert.equal(limited.every(item => item.target.type === 'dashboard'), true)
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
