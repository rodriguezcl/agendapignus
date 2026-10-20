const test = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../src/domain/dashboard/dashboard-notifications.mjs')
const customer = (extra = {}) => ({
  customerId: 'retired', account: 'CLI-0176', kind: 'client', name: 'CLIENTE DE PRUEBA',
  convertedFromAccount: 'PIG-1234', subscriptionEndedAt: '2026-10-20T19:02:00.000Z', ...extra
})
const user = (extra = {}) => ({ id: 'reader', roleCode: 'custom', permissions: {
  __catalogV2: true, 'accounts.view': true, 'notifications.softguard': true, ...extra
} })
const notices = async (customers, subject = user(), history = []) => {
  const { selectDashboardNotifications } = await load()
  return selectDashboardNotifications({ customers, history, user: subject, today: '2026-10-20' })
    .filter(notice => notice.target.type === 'softguard-retirement')
}

test('a confirmed subscriber retirement produces an actionable notice without a reimport or history access', async () => {
  const records = [customer()]
  const before = structuredClone(records)
  const result = await notices(records)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'softguard-retirement:retired')
  assert.equal(result[0].title, 'Baja pendiente en SoftGuard')
  assert.match(result[0].detail, /PIG-1234.*CLI-0176/)
  assert.deepEqual(result[0].target, { type: 'softguard-retirement', customerId: 'retired' })
  assert.deepEqual(records, before)
  assert.deepEqual(await notices(records), result, 'opening a notice cannot resolve its cause')
})

test('SoftGuard notices respect category, account access and customer scopes; administrators see all', async () => {
  const customers = [customer(), customer({ customerId: 'cctv', account: 'CLI-0177', cctvService: true })]
  assert.equal((await notices(customers, user({ 'notifications.softguard': false }))).length, 0)
  assert.equal((await notices(customers, user({ 'accounts.view': false }))).length, 0)
  const scoped = await notices(customers, user({ 'scope.customers.read.cctv': true }))
  assert.deepEqual(scoped.map(notice => notice.target.customerId), ['cctv'])
  const admin = { ...user({ 'notifications.softguard': false }), roleCode: 'administrator' }
  assert.equal((await notices(customers, admin)).length, 2)
})

test('only the resolution of this retirement removes the notice, and old untracked retirements stay excluded', async () => {
  const current = customer()
  const resolution = {
    convertedFromAccount: current.convertedFromAccount, subscriptionEndedAt: current.subscriptionEndedAt,
    completedAt: '2026-10-20T20:00:00.000Z', completedBy: 'admin', completedByName: 'Administración'
  }
  assert.equal((await notices([customer({ softguardRetirementResolution: resolution })])).length, 0)
  assert.equal((await notices([customer({ softguardRetirementResolution: { ...resolution, subscriptionEndedAt: '2026-10-19T18:00:00Z' } })])).length, 1)
  assert.equal((await notices([customer({ subscriptionEndedAt: '2026-10-20T02:59:59.999Z' })])).length, 0)
  assert.equal((await notices([customer({ kind: 'subscriber', account: 'PIG-1234' })])).length, 0)
  assert.equal((await notices([customer({ convertedFromAccount: undefined })])).length, 0)
})

test('resolving a retirement does not suppress the separate reimport verification notice', async () => {
  const { selectDashboardNotifications } = await load()
  const retired = customer()
  const subscribers = [retired, { customerId: 'pig', account: 'PIG-1234', name: retired.name }]
  const result = selectDashboardNotifications({ customers: subscribers, user: user() })
  assert(result.some(notice => notice.id === 'softguard-retirement:retired'))
  assert(result.some(notice => notice.id === 'softguard-verification'))
  retired.softguardRetirementResolution = {
    convertedFromAccount: retired.convertedFromAccount, subscriptionEndedAt: retired.subscriptionEndedAt,
    completedAt: '2026-10-20T20:00:00.000Z', completedBy: 'admin', completedByName: 'Administración'
  }
  const after = selectDashboardNotifications({ customers: subscribers, user: user() })
  assert(!after.some(notice => notice.id === 'softguard-retirement:retired'))
  assert(after.some(notice => notice.id === 'softguard-verification'))
})
