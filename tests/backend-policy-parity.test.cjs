const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const vm = require('node:vm')
const core = require('../api/_lib/core.cjs')

// Load only the local adapter's policy bindings: starting the HTTP server would
// create a database and run migrations, unrelated to these parity assertions.
const serverPath = path.resolve(__dirname, '../server.cjs')
const source = fs.readFileSync(serverPath, 'utf8')
const policyImports = source.match(/^const \{ .+ \} = require\('\.\/api\/_lib\/(?:service-completion|access-policy|employee-credentials|report-formatting)\.cjs'\)$/gm) || []
assert.equal(policyImports.length, 4)
const local = vm.runInNewContext(`${policyImports.join('\n')}\n;({ userCan, assertVehicleControlOmissionAuthorized, assertServiceCanBeCompleted, normalizeHistoryCompletionTimes, publicEmployee, auditSafe, hashPassword, verifyPassword, reportDate, professionalExcelHtml })`, { require: createRequire(serverPath) })

test('local and serverless adapters enforce the same opt-in and parent permission rules', () => {
  for (const user of [
    { roleCode: 'administrator' }, { roleCode: 'supervisor' }, { roleCode: 'operator' },
    { role: 'SUPERVISÓR' }, { roleCode: 'custom', permissions: { accounts: true, accountsEdit: true } },
    { roleCode: 'custom', permissions: { accountsEdit: true } },
    { roleCode: 'custom', permissions: { accounts: true } }, {}, null
  ]) {
    for (const permission of ['weekly', 'history', 'accounts', 'accountsEdit', 'accountsDelete', 'weeklyTeams', 'unknown']) {
      assert.equal(local.userCan(user, permission), core.userCan(user, permission))
    }
  }
  assert.equal(local.userCan({ roleCode: 'custom', permissions: { accountsEdit: true } }, 'accountsEdit'), false)
  assert.equal(local.userCan({ roleCode: 'operator', permissions: { accountsEdit: true, accounts: true } }, 'accountsEdit'), false)
  const current = { agenda: { weekly: { '2026-10-20': { teams: [{ teamId: 'team1', tasks: [{ vehicleControl: true, historyId: 'control1', taskId: 'task1' }] }] } } }, history: [] }
  const proposed = structuredClone(current)
  proposed.agenda.weekly['2026-10-20'].removedTaskIds = ['history:control1']
  assert.throws(() => local.assertVehicleControlOmissionAuthorized(proposed, current, { roleCode: 'custom' }), { statusCode: 403 })
  assert.doesNotThrow(() => local.assertVehicleControlOmissionAuthorized(proposed, current, { roleCode: 'administrator' }))
})

test('completion policies match across adapters at Argentina midnight and retain original timestamps', () => {
  const now = '2026-10-20T02:30:00.000Z' // Still October 19 in Argentina.
  for (const record of [
    { date: '2026-10-19', time: '23:29' },
    { date: '2026-10-19', time: '23:31' },
    { date: '2026-10-20', time: '00:00' },
    { date: '2026-10-18', time: '23:59' }
  ]) {
    const outcome = policy => {
      try { policy(record, now); return 'allowed' } catch (error) { return { message: error.message, statusCode: error.statusCode } }
    }
    assert.deepEqual(outcome(local.assertServiceCanBeCompleted), outcome(core.assertServiceCanBeCompleted))
  }
  const pending = { id: 'service1', date: '2026-10-19', time: '23:00', status: 'Pendiente' }
  const proposed = [{ ...pending, status: 'Completado', completedAt: '2000-01-01T00:00:00Z' }]
  const saved = local.normalizeHistoryCompletionTimes(proposed, [pending], now)
  assert.deepEqual(saved, core.normalizeHistoryCompletionTimes(proposed, [pending], now))
  assert.equal(saved[0].completedAt, now)
  assert.equal(local.normalizeHistoryCompletionTimes(saved, saved, '2026-10-21T00:00:00Z')[0].completedAt, now)
})

test('both adapters use identical credentials and safely reject malformed stored hashes', () => {
  const password = 'PruebaSegura1234!'
  const salt = 'fixed-test-salt'
  const hash = local.hashPassword(password, salt)
  assert.equal(hash, core.hashPassword(password, salt))
  assert.equal(core.verifyPassword(password, hash), true)
  assert.equal(local.verifyPassword('Incorrecta1234!', hash), false)
  for (const malformed of ['', 'legacy-password', 'salt:', 'salt:aa', 'salt:not-hex']) {
    assert.equal(local.verifyPassword(password, malformed), false)
    assert.equal(core.verifyPassword(password, malformed), false)
  }
  const employee = { id: 'employee1', name: 'Employee', password, passwordHash: hash }
  assert.deepEqual(local.publicEmployee(employee), core.publicEmployee(employee))
  assert.deepEqual(local.auditSafe(employee), { id: 'employee1', name: 'Employee' })
})

test('local and serverless spreadsheet reports share safe HTML, date and contact formatting', () => {
  assert.equal(local.professionalExcelHtml, core.professionalExcelHtml)
  assert.equal(local.reportDate, core.reportDate)
  assert.equal(local.reportDate('2026-10-01'), '01/10/2026')
  const html = local.professionalExcelHtml({
    title: '<Report>', description: 'A & B', month: '2026-10',
    headers: ['Fecha', 'Cliente', 'Contacto'],
    rows: [['2026-10-01', '<script>alert("x")</script>', '00112233'], ['2026-10-02', "O'Connor", '+54 351 1234']],
    widths: ['20%', '50%', '30%']
  })
  assert.match(html, /01\/10\/2026/)
  assert.match(html, /class="text-value contact">00112233/)
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/)
  assert.match(html, /O&#39;Connor/)
  assert.match(html, /class="alternate"/)
  assert.doesNotMatch(html, /<script>/)
})
