const test = require('node:test')
const assert = require('node:assert/strict')
const { saveTiming } = require('../api/_lib/save-timing.cjs')

test('save timing reports durations without application data', () => {
  let now = 100
  const timing = saveTiming(() => now)
  now = 130; timing.mark('read_state')
  now = 135; timing.mark('lock_wait')
  now = 140
  const headers = {}, logs = []
  timing.finish({ setHeader: (key, value) => { headers[key] = value } }, 'success', value => logs.push(JSON.parse(value)))
  assert.equal(headers['Server-Timing'], 'read_state;dur=30.0, lock_wait;dur=5.0, total;dur=40.0')
  assert.deepEqual(logs, [{ scope: 'state_write_timing', outcome: 'success', totalMs: 40, stages: [{ name: 'read_state', ms: 30 }, { name: 'lock_wait', ms: 5 }] }])
  assert.throws(() => timing.mark('unsafe\r\nheader'))
})
