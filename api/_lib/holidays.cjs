const CACHE_TTL_MS = 12 * 60 * 60 * 1000
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

async function fetchJson(url, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`Respuesta ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchNationalHolidays(year, fetchImpl = globalThis.fetch) {
  const cached = holidayCache.get(year)
  if (cached && cached.expiresAt > Date.now()) return cached.records
  if (typeof fetchImpl !== 'function') throw new Error('No hay conexión disponible para consultar feriados.')

  let records = []
  try {
    records = normalizeArgentinaData(await fetchJson(`https://api.argentinadatos.com/v1/feriados/${year}`, fetchImpl, 8_000))
  } catch (primaryError) {
    try {
      records = normalizeNagerData(await fetchJson(`https://nagerholidays.com/api/v4/Holidays/AR/${year}`, fetchImpl, 8_000))
    } catch {
      const error = new Error('No se pudo consultar el calendario nacional de feriados.')
      error.cause = primaryError
      throw error
    }
  }
  if (!records.length) throw new Error('El calendario consultado no contiene feriados para ese año.')
  const unique = [...new Map(records.map(record => [record.date, record])).values()].sort((left, right) => left.date.localeCompare(right.date))
  holidayCache.set(year, { records: unique, expiresAt: Date.now() + CACHE_TTL_MS })
  return unique
}

module.exports = { fetchNationalHolidays, normalizeArgentinaData, normalizeNagerData, validHolidayYear }
