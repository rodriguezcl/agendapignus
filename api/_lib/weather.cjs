const URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-31.4201&lon=-64.1888'
const USER_AGENT = 'PignusAgenda/1.0 https://github.com/rodriguezcl/agendapignus'
const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Cordoba' })

function conditionFor(symbol = '') {
  if (symbol.includes('thunder')) return { kind: 'storm', label: 'Tormentas', rank: 6 }
  if (/snow|sleet/.test(symbol)) return { kind: 'snow', label: 'Nieve / aguanieve', rank: 5 }
  if (/rain/.test(symbol)) return { kind: 'rain', label: 'Lluvias', rank: 4 }
  if (symbol.includes('fog')) return { kind: 'fog', label: 'Niebla', rank: 3 }
  if (/partlycloudy|fair/.test(symbol)) return { kind: 'partly', label: 'Parcialmente nublado', rank: 1 }
  if (symbol.includes('cloudy')) return { kind: 'cloud', label: 'Nublado', rank: 2 }
  if (symbol.includes('clearsky')) return { kind: 'sun', label: 'Despejado', rank: 0 }
  return null
}

// Temperatures are a range of forecast samples, not observed daily extrema.
function summarizeForecast(payload) {
  const groups = new Map()
  for (const point of payload?.properties?.timeseries || []) {
    const time = new Date(point.time)
    const temperature = point.data?.instant?.details?.air_temperature
    if (!Number.isFinite(time.getTime()) || !Number.isFinite(temperature)) continue
    const date = dateFormatter.format(time)
    const period = point.data.next_1_hours || point.data.next_6_hours || point.data.next_12_hours
    const condition = conditionFor(period?.summary?.symbol_code)
    const group = groups.get(date) || { date, min: temperature, max: temperature, condition: null }
    group.min = Math.min(group.min, temperature)
    group.max = Math.max(group.max, temperature)
    if (condition && (!group.condition || condition.rank > group.condition.rank)) group.condition = condition
    groups.set(date, group)
  }
  const days = [...groups.values()].filter(day => day.condition).map(({ date, min, max, condition }) => ({ date, min: Math.round(min), max: Math.round(max), kind: condition.kind, label: condition.label }))
  if (!days.length) throw new Error('Pronóstico no disponible')
  return { location: 'Córdoba capital', updatedAt: payload.properties.meta?.updated_at || null, days }
}

function createWeatherService({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cached, expiresAt = 0, lastModified, pending, retryAt = 0
  return async function fetchWeather() {
    if (cached && now() < expiresAt) return { ...cached, stale: false }
    if (pending) return pending
    if (now() < retryAt) return cached ? { ...cached, stale: true } : { location: 'Córdoba capital', days: [], unavailable: true }
    pending = (async () => {
      try {
        const response = await fetchImpl(URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(lastModified ? { 'If-Modified-Since': lastModified } : {}) }, signal: AbortSignal.timeout(6000) })
        if (response.status !== 304 && !response.ok) throw new Error('Proveedor no disponible')
        if (response.status === 304 && !cached) throw new Error('Sin pronóstico almacenado')
        if (response.status !== 304) {
          cached = summarizeForecast(await response.json())
          lastModified = response.headers.get('last-modified')
        }
        const expiry = Date.parse(response.headers.get('expires'))
        expiresAt = Number.isFinite(expiry) && expiry > now() ? expiry : now() + 30 * 60 * 1000
        return { ...cached, stale: false }
      } catch {
        retryAt = now() + 5 * 60 * 1000
        return cached ? { ...cached, stale: true } : { location: 'Córdoba capital', days: [], unavailable: true }
      } finally { pending = null }
    })()
    return pending
  }
}

module.exports = { fetchWeather: createWeatherService(), createWeatherService, summarizeForecast, conditionFor }
