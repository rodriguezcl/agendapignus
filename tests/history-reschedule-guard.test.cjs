const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const app = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const source = app.slice(app.indexOf('function HistoryManagementDetail'), app.indexOf('function HistoryDetail('))

test('actual readiness validation accepts valid hours including 14:00 and rejects incomplete inputs', async () => {
  const { requiresDifferentRescheduleDay } = await import('../src/domain/history/history-edit-policy.mjs')
  const expression = source.split(/\r?\n/).find(line => line.includes('const rescheduleReady ='))
  const ready = (patch = {}) => vm.runInNewContext(expression + '\nrescheduleReady', {
    requiresDifferentRescheduleDay, record: { date: '2026-09-18', technicalStatus: 'Reprogramación solicitada' },
    rescheduleDate: '2026-09-21', minimumRescheduleDate: '2026-09-18',
    selectedRescheduleTeam: { teamId: '1' }, rescheduleTime: '14:00', ...patch
  })
  for (const time of ['00:00', '08:30', '14:00', '19:59', '20:00', '23:59']) assert.equal(ready({ rescheduleTime: time }), true, time)
  for (const time of ['', '24:00', '14:60', '200:00', '2:30', '14:00:00']) assert.equal(ready({ rescheduleTime: time }), false, time)
  assert.equal(ready({ selectedRescheduleTeam: undefined }), false)
  assert.equal(ready({ rescheduleDate: '' }), false)
  assert.equal(ready({ rescheduleDate: '2026-09-17' }), false)
  assert.equal(ready({ rescheduleDate: '2026-09-18' }), false)
})

test('closing an unfinished reschedule prompts, an empty one closes, saving cannot close', () => {
  const start = source.indexOf('  const requestClose = () => {')
  const end = source.indexOf('  useEffect(', start)
  for (const [saving, hasRescheduleDraft, expected] of [[false, true, 'leave'], [false, false, 'closed'], [true, true, 'none']]) {
    let result = 'none'
    vm.runInNewContext(source.slice(start, end) + '\nrequestClose()', { saving, hasRescheduleDraft, close: () => { result = 'closed' }, setReschedulePrompt: value => { result = value } })
    assert.equal(result, expected)
  }
})

test('confirmation closes only after successful persistence; failure keeps draft and reports error', async () => {
  const start = source.indexOf('  const confirmReschedule = async () => {')
  const end = source.indexOf('  const minimumRescheduleDate', start)
  for (const fail of [false, true]) {
    let closed = false, error = '', saving = false
    const confirm = vm.runInNewContext(source.slice(start, end) + '\nconfirmReschedule', {
      interactionBlocked: false, rescheduleReady: true, record: {}, rescheduleDate: '2096-09-11', rescheduleTeam: 'team', rescheduleTime: '14:00',
      setSaving: value => { saving = value }, setRescheduleError: value => { error = value }, close: () => { closed = true },
      historyScheduling: { save: async () => { if (fail) throw new Error('Conflicto de horarios') } }
    })
    await confirm()
    assert.equal(closed, !fail)
    assert.equal(saving, false)
    assert.equal(error, fail ? 'Conflicto de horarios' : '')
  }
})

test('close routes through guard and explicit confirmation shows summary without saving directly', () => {
  assert.match(source, /className="close-modal" disabled=\{saving\} onClick=\{requestClose\}/)
  assert.match(source, /else if \(rescheduleReady\) \{ setRescheduleError\(''\); setReschedulePrompt\('confirm'\)/)
  assert.match(source, /Cancelar reprogramación/)
  assert.match(source, /Seguir editando/)
  assert.match(source, /disabled=\{interactionBlocked \|\| !rescheduleReady\} onClick=\{confirmReschedule\}/)
})
