const NATIONAL_HOLIDAY_CACHE_PREFIX = 'pignus-national-holidays-v1'
export const NATIONAL_HOLIDAY_CACHE_TTL_MS = 12 * 60 * 60 * 1000

const holidayCacheKey = year => `${NATIONAL_HOLIDAY_CACHE_PREFIX}:${year}`

export function readNationalHolidayCache(years, storage = globalThis.localStorage, now = Date.now()) {
  const requestedYears = [...new Set((years || []).filter(Boolean).map(String))]
  if (!requestedYears.length) return { complete: true, records: [] }
  if (!storage?.getItem) return { complete: false, records: [] }
  const records = []
  try {
    for (const year of requestedYears) {
      const cached = JSON.parse(storage.getItem(holidayCacheKey(year)) || 'null')
      if (!cached || cached.expiresAt <= now || !Array.isArray(cached.records) || !cached.records.length) {
        return { complete: false, records: [] }
      }
      records.push(...cached.records)
    }
    return { complete: true, records }
  } catch {
    return { complete: false, records: [] }
  }
}

export function writeNationalHolidayCache(year, records, storage = globalThis.localStorage, now = Date.now()) {
  if (!storage?.setItem || !Array.isArray(records) || !records.length) return false
  try {
    storage.setItem(holidayCacheKey(String(year)), JSON.stringify({ records, expiresAt: now + NATIONAL_HOLIDAY_CACHE_TTL_MS }))
    return true
  } catch {
    return false
  }
}
