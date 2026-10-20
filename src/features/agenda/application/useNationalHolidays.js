import { useState, useEffect } from "react";
import { readNationalHolidayCache, writeNationalHolidayCache } from "../../../infrastructure/browser/holiday-cache.mjs";
import { fetchWithTimeout } from "../../../infrastructure/http/fetch-timeout.mjs";

export function useNationalHolidays(years) {
  const yearKey = [...new Set((years || []).filter(Boolean).map(String))].sort().join(',')
  const [state, setState] = useState({ key: '', records: [], loading: true, error: '' })
  useEffect(() => {
    const requestedYears = yearKey.split(',').filter(Boolean)
    if (!requestedYears.length) { setState({ key: yearKey, records: [], loading: false, error: '' }); return undefined }
    const cached = readNationalHolidayCache(requestedYears)
    if (cached.complete) {
      setState({ key: yearKey, records: cached.records, loading: false, error: '' })
      return undefined
    }
    let active = true
    setState(previous => ({ ...previous, key: yearKey, loading: true, error: '' }))
    Promise.all(requestedYears.map(async year => {
      const response = await fetchWithTimeout(`/api/holidays?year=${encodeURIComponent(year)}`, { credentials: 'same-origin' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'No se pudo consultar el calendario de feriados.')
      const records = payload.holidays || []
      writeNationalHolidayCache(year, records)
      return records
    })).then(groups => {
      if (active) setState({ key: yearKey, records: groups.flat(), loading: false, error: '' })
    }).catch(error => {
      if (active) setState({ key: yearKey, records: [], loading: false, error: error.message })
    })
    return () => { active = false }
  }, [yearKey])
  return state.key === yearKey ? state : { records: [], loading: true, error: '' }
}
