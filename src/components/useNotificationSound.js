import { useEffect, useRef, useState } from 'react'
import { createNotificationSoundTracker } from '../domain/dashboard/notification-sound.mjs'
import { createNotificationChime } from '../infrastructure/browser/notification-chime.mjs'

export default function useNotificationSound({ notifications, userKey, readySources }) {
  const storageKey = `pignus:notification-sound:${encodeURIComponent(userKey || 'local')}`
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(storageKey) === 'on' } catch { return false } })
  const [message, setMessage] = useState('')
  const audio = useRef(null), timer = useRef(null), active = useRef(enabled)
  const tracker = useRef(null)
  if (!tracker.current) tracker.current = createNotificationSoundTracker()
  active.current = enabled

  useEffect(() => {
    audio.current = createNotificationChime()
    const unlock = () => { if (active.current) void audio.current?.unlock() }
    document.addEventListener('click', unlock)
    document.addEventListener('keydown', unlock)
    const sync = event => { if (event.key === storageKey) { active.current = event.newValue === 'on'; setEnabled(active.current); clearTimeout(timer.current); timer.current = null } }
    window.addEventListener('storage', sync)
    return () => {
      document.removeEventListener('click', unlock); document.removeEventListener('keydown', unlock)
      window.removeEventListener('storage', sync)
      clearTimeout(timer.current); audio.current?.dispose(); audio.current = null
    }
  }, [storageKey])

  useEffect(() => {
    const arrived = tracker.current(notifications, readySources)
    if (!enabled) { clearTimeout(timer.current); timer.current = null; return }
    if (!arrived || timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      if (active.current && !audio.current?.play()) setMessage('Presioná Probar sonido para habilitar el audio en este navegador.')
    }, 800)
  }, [notifications, readySources, enabled])

  const test = async () => {
    const player = audio.current
    const unlocked = await player?.unlock()
    if (player !== audio.current || !active.current) return
    setMessage(unlocked && player.play() ? '' : 'No se pudo reproducir. Revisá que el navegador permita sonido para este sitio.')
  }
  const toggle = () => {
    const next = !enabled
    active.current = next; setEnabled(next); setMessage('')
    clearTimeout(timer.current); timer.current = null
    try { localStorage.setItem(storageKey, next ? 'on' : 'off') } catch { /* In-memory preference remains usable. */ }
    if (next) void test()
  }
  return { enabled, toggle, test, message }
}
