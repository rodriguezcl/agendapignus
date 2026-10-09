const { test } = require('node:test')
const assert = require('node:assert/strict')
const { summarizeForecast, createWeatherService } = require('../api/_lib/weather.cjs')
const { operatorRouteAllowed } = require('../api/_lib/operator-access.cjs')
const point = (time, temperature, symbol) => ({ time, data: { instant: { details: { air_temperature: temperature } }, next_6_hours: { summary: { symbol_code: symbol } } } })
const payload = { properties: { meta: { updated_at: '2026-10-09T00:00:00Z' }, timeseries: [
  point('2026-10-10T00:00:00Z', 15, 'clearsky_night'),
  point('2026-10-10T06:00:00Z', 18, 'partlycloudy_day'),
  point('2026-10-10T12:00:00Z', 25, 'rain'),
  point('2026-10-10T18:00:00Z', 22, 'rainandthunder'),
] } }
test('groups samples by Córdoba date and highlights storms without inventing probabilities', () => {
  const data = summarizeForecast(payload)
  assert.deepEqual(data.days, [
    { date: '2026-10-09', min: 15, max: 15, kind: 'sun', label: 'Despejado' },
    { date: '2026-10-10', min: 18, max: 25, kind: 'storm', label: 'Tormentas' }
  ])
  assert.throws(() => summarizeForecast({}))
})
test('coalesces concurrent requests, respects Expires and revalidates with Last-Modified', async () => {
  let time = Date.parse('2026-10-09T10:00:00Z'), count = 0
  const service = createWeatherService({ now: () => time, fetchImpl: async (url, options) => {
    count++
    assert.match(url, /lat=-31.4201&lon=-64.1888/)
    assert.match(options.headers['User-Agent'], /github.com\/rodriguezcl\/agendapignus/)
    if (count === 2) assert.equal(options.headers['If-Modified-Since'], 'Fri, 09 Oct 2026 09:00:00 GMT')
    return { ok: true, status: count === 1 ? 200 : 304, json: async () => payload, headers: new Headers({ expires: new Date(time + 3600000).toUTCString(), 'last-modified': 'Fri, 09 Oct 2026 09:00:00 GMT' }) }
  } })
  const [a, b] = await Promise.all([service(), service()])
  assert.deepEqual(a, b)
  await service()
  assert.equal(count, 1)
  time += 3600001
  assert.deepEqual(await service(), a)
  assert.equal(count, 2)
})
test('provider failure keeps cached forecast marked stale and backs off', async () => {
  let time = 0, count = 0
  const service = createWeatherService({ now: () => time, fetchImpl: async () => {
    if (++count > 1) throw Error('offline')
    return { ok: true, status: 200, headers: new Headers(), json: async () => payload }
  } })
  await service()
  time += 3600000
  assert.equal((await service()).stale, true)
  await service()
  assert.equal(count, 2)
})
test('initial failure is nonblocking and read-only users can only GET weather', async () => {
  const service = createWeatherService({ fetchImpl: async () => { throw Error('offline') } })
  assert.equal((await service()).unavailable, true)
  assert.equal(operatorRouteAllowed('GET', '/weather'), true)
  assert.equal(operatorRouteAllowed('POST', '/weather'), false)
})
