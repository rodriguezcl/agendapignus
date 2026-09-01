const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const PROVIDER_TIMEOUT_MS = 2_000
const holidayCache = new Map()

function validHolidayYear(value, now = new Date()) {
  const year = Number(value)
  const currentYear = now.getUTCFullYear()
  return Number.isInteger(year) && year >= currentYear - 2 && year <= currentYear + 5 ? year : null
}

function normalizeArgentinaData(records) {
  if (!Array.isArray(records)) return []
  return records.map(record => ({
    date: String(record.fecha || ''),
    name: String(record.nombre || 'Feriado nacional').trim(),
    type: String(record.tipo || 'Feriado nacional').trim(),
    source: 'ArgentinaDatos'
  })).filter(record => /^\d{4}-\d{2}-\d{2}$/.test(record.date))
}

function normalizeNagerData(records) {
  if (!Array.isArray(records)) return []
  return records.filter(record => record.nationalHoliday !== false).map(record => ({
    date: String(record.date || ''),
    name: String(record.name || 'Feriado nacional').trim(),
    type: Array.isArray(record.holidayTypes) ? record.holidayTypes.join(', ') : 'Public',
    source: 'Nager.Holidays'
  })).filter(record => /^\d{4}-\d{2}-\d{2}$/.test(record.date))
}

const isoDate = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

function shiftDate(date, amount) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return isoDate(year, month, day)
}

function observedMovableDate(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  if (day === 2) return shiftDate(date, -1)
  if (day === 3) return shiftDate(date, -2)
  if (day === 4) return shiftDate(date, 4)
  if (day === 5) return shiftDate(date, 3)
  return date
}

function localHolidayFallback(year) {
  const easter = easterSunday(year)
  const records = [
    [isoDate(year, 1, 1), 'Año nuevo', 'inamovible'],
    [shiftDate(easter, -48), 'Carnaval', 'inamovible'],
    [shiftDate(easter, -47), 'Carnaval', 'inamovible'],
    [isoDate(year, 3, 24), 'Día Nacional de la Memoria por la Verdad y la Justicia', 'inamovible'],
    [isoDate(year, 4, 2), 'Día del Veterano y de los Caídos en la Guerra de Malvinas', 'inamovible'],
    [shiftDate(easter, -2), 'Viernes Santo', 'inamovible'],
    [isoDate(year, 5, 1), 'Día del Trabajador', 'inamovible'],
    [isoDate(year, 5, 25), 'Día de la Revolución de Mayo', 'inamovible'],
    [observedMovableDate(isoDate(year, 6, 17)), 'Paso a la Inmortalidad del General Martín Güemes', 'trasladable'],
    [isoDate(year, 6, 20), 'Paso a la Inmortalidad del General Manuel Belgrano', 'inamovible'],
    [isoDate(year, 7, 9), 'Día de la Independencia', 'inamovible'],
    [observedMovableDate(isoDate(year, 8, 17)), 'Paso a la Inmortalidad del Gral. José de San Martín', 'trasladable'],
    [observedMovableDate(isoDate(year, 10, 12)), 'Día del Respeto a la Diversidad Cultural', 'trasladable'],
    [observedMovableDate(isoDate(year, 11, 20)), 'Día de la Soberanía Nacional', 'trasladable'],
    [isoDate(year, 12, 8), 'Día de la Inmaculada Concepción de María', 'inamovible'],
    [isoDate(year, 12, 25), 'Navidad', 'inamovible']
  ]
  // Fechas turísticas 2026 establecidas por la Resolución 164/2025.
  if (year === 2026) records.push(
    ['2026-03-23', 'Puente turístico no laborable', 'puente'],
    ['2026-07-10', 'Puente turístico no laborable', 'puente'],
    ['2026-12-07', 'Puente turístico no laborable', 'puente']
  )
  return [...new Map(records.map(([date, name, type]) => [date, { date, name, type, source: 'Respaldo legal local' }])).values()].sort((left, right) => left.date.localeCompare(right.date))
}

async function fetchJson(url, fetchImpl, timeoutMs, externalSignal) {
  const controller = new AbortController()
  const abortFromOutside = () => controller.abort()
  externalSignal?.addEventListener('abort', abortFromOutside, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`Respuesta ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromOutside)
  }
}

async function firstAvailableHolidayRecords(providers) {
  const controllers = providers.map(() => new AbortController())
  return new Promise(resolve => {
    let pending = providers.length
    let settled = false
    const finishEmptyProvider = () => {
      pending -= 1
      if (!settled && pending === 0) resolve([])
    }
    providers.forEach((provider, index) => {
      Promise.resolve().then(() => provider(controllers[index].signal)).then(records => {
        if (settled) return
        if (!Array.isArray(records) || !records.length) { finishEmptyProvider(); return }
        settled = true
        controllers.forEach((controller, controllerIndex) => {
          if (controllerIndex !== index) controller.abort()
        })
        resolve(records)
      }).catch(finishEmptyProvider)
    })
  })
}

async function fetchNationalHolidays(year, fetchImpl = globalThis.fetch) {
  const cached = holidayCache.get(year)
  if (cached && cached.expiresAt > Date.now()) return cached.records
  if (typeof fetchImpl !== 'function') throw new Error('No hay conexión disponible para consultar feriados.')

  const records = await firstAvailableHolidayRecords([
    signal => fetchJson(`https://api.argentinadatos.com/v1/feriados/${year}`, fetchImpl, PROVIDER_TIMEOUT_MS, signal).then(normalizeArgentinaData),
    signal => fetchJson(`https://nagerholidays.com/api/v4/Holidays/AR/${year}`, fetchImpl, PROVIDER_TIMEOUT_MS, signal).then(normalizeNagerData)
  ])
  const availableRecords = records.length ? records : localHolidayFallback(year)
  const unique = [...new Map(availableRecords.map(record => [record.date, record])).values()].sort((left, right) => left.date.localeCompare(right.date))
  holidayCache.set(year, { records: unique, expiresAt: Date.now() + CACHE_TTL_MS })
  return unique
}

module.exports = { fetchNationalHolidays, firstAvailableHolidayRecords, localHolidayFallback, normalizeArgentinaData, normalizeNagerData, validHolidayYear }
