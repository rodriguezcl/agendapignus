import React, { useEffect, useState } from 'react'
import './weekly-weather.css'

export function useWeeklyWeather() {
  const [weather, setWeather] = useState({ days: [], loading: true })
  useEffect(() => {
    let active = true
    let controller
    const refresh = async () => {
      if (document.hidden) return
      controller?.abort()
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 9000)
      try {
        const response = await fetch('/api/weather', { credentials: 'same-origin', signal: controller.signal })
        if (!response.ok) throw new Error('Clima no disponible')
        const data = await response.json()
        if (!Array.isArray(data.days)) throw new Error('Pronóstico inválido')
        if (active) setWeather(data)
      } catch {
        if (active) setWeather(previous => ({ ...previous, loading: false, unavailable: !previous.days.length, stale: Boolean(previous.days.length) }))
      } finally { clearTimeout(timeout) }
    }
    refresh()
    const interval = setInterval(refresh, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; controller?.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  return weather
}

export function WeatherArt({ kind }) {
  if (!kind || kind === 'none') return null
  return <svg className="weekly-weather-art" viewBox="0 0 120 80" fill="none" aria-hidden="true">
    {['sun', 'partly'].includes(kind) && <g stroke="#d79b16" strokeWidth="3"><circle cx="77" cy="29" r="16" fill="#ffd05b" /><path d="M77 3v6m0 40v6M51 29h6m40 0h6M59 11l5 5m26 26 5 5m0-36-5 5M64 42l-5 5" /></g>}
    {kind !== 'sun' && <path d="M31 53c-16-1-16-23 0-25 2-21 35-23 42-3 23-5 34 28 9 28Z" fill="#9ab4c9" stroke="#718fa7" strokeWidth="2" />}
    {['rain', 'storm'].includes(kind) && <path d="m34 61-5 10m25-10-5 10m25-10-5 10m25-10-5 10" stroke="#428ac4" strokeWidth="4" strokeLinecap="round" />}
    {kind === 'storm' && <path d="m66 43-10 17h10l-6 17 22-25H68l7-9" fill="#efb524" />}
    {kind === 'fog' && <path d="M24 62h71M34 70h51" stroke="#718fa7" strokeWidth="4" strokeLinecap="round" />}
    {kind === 'snow' && <g fill="#668eac"><circle cx="35" cy="65" r="3" /><circle cx="60" cy="70" r="3" /><circle cx="85" cy="64" r="3" /></g>}
  </svg>
}

export function WeeklyWeather({ day, today, weather }) {
  const forecast = day >= today && weather.days.find(item => item.date === day)
  if (!forecast) return <small className="weekly-weather-line">{day < today ? 'Sin pronóstico histórico' : weather.loading ? 'Consultando clima…' : weather.unavailable ? 'Clima no disponible' : 'Sin pronóstico disponible'}</small>
  return <div className="weekly-weather-copy" title="Córdoba capital · Rango aproximado de temperaturas de los períodos disponibles; para hoy incluye las horas restantes. La condición destaca el fenómeno más relevante previsto.">
    <small className="weekly-weather-line">{forecast.label}</small>
    <small className="weekly-weather-line">{forecast.min}–{forecast.max} °C · Córdoba{weather.stale ? ' · Sin actualizar' : ''}</small>
  </div>
}

export function WeatherCredit() {
  return <p className="weekly-weather-credit">Clima en Córdoba capital · <a href="https://www.met.no/" target="_blank" rel="noreferrer">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Resumen diario de períodos previstos.</p>
}
