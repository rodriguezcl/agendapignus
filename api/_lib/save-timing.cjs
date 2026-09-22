const { performance } = require('node:perf_hooks')

// Only fixed stage names and durations: never log services, customers or payloads.
function saveTiming(clock = () => performance.now()) {
  const started = clock()
  let previous = started
  const stages = []
  return {
    mark(name) {
      if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid timing stage')
      const now = clock()
      stages.push({ name, ms: Math.max(0, now - previous) })
      previous = now
    },
    finish(res, outcome, writer = console.info) {
      const total = Math.max(0, clock() - started)
      res.setHeader('Server-Timing', [...stages, { name: 'total', ms: total }].map(({ name, ms }) => `${name};dur=${ms.toFixed(1)}`).join(', '))
      writer(JSON.stringify({ scope: 'state_write_timing', outcome, totalMs: Math.round(total), stages: stages.map(({ name, ms }) => ({ name, ms: Math.round(ms) })) }))
    }
  }
}

module.exports = { saveTiming }
