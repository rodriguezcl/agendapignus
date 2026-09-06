import { useEffect, useRef } from 'react'
import { sessionRepository } from '../../../infrastructure/repositories/session-repository.mjs'

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const SESSION_STATUS_INTERVAL_MS = 5 * 1000
const ACTIVITY_SYNC_INTERVAL_MS = 60 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll']

export function useSessionLifecycle({ enabled, onInvalidated, onIdle }) {
  const invalidatedRef = useRef(onInvalidated)
  const idleRef = useRef(onIdle)
  invalidatedRef.current = onInvalidated
  idleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return undefined
    let stopped = false
    let checking = false
    let syncing = false
    let activitySyncTimer = null
    let lastActivityAt = Date.now()
    let lastSyncedAt = 0

    const invalidate = error => {
      if (stopped) return
      stopped = true
      invalidatedRef.current(error?.message)
    }
    const syncActivity = async () => {
      if (stopped) return
      const remaining = ACTIVITY_SYNC_INTERVAL_MS - (Date.now() - lastSyncedAt)
      if (syncing || remaining > 0) {
        if (!activitySyncTimer) {
          activitySyncTimer = window.setTimeout(() => {
            activitySyncTimer = null
            void syncActivity()
          }, syncing ? ACTIVITY_SYNC_INTERVAL_MS : remaining)
        }
        return
      }
      syncing = true
      lastSyncedAt = Date.now()
      try {
        await sessionRepository.touch()
      } catch (error) {
        if (error.status === 401) invalidate(error)
      } finally {
        syncing = false
      }
    }
    const registerActivity = () => {
      lastActivityAt = Date.now()
      void syncActivity()
    }
    const checkStatus = async () => {
      if (stopped || checking || document.visibilityState === 'hidden') return
      if (Date.now() - lastActivityAt >= SESSION_IDLE_TIMEOUT_MS) {
        stopped = true
        await idleRef.current()
        return
      }
      checking = true
      try {
        await sessionRepository.status()
      } catch (error) {
        if (error.status === 401) invalidate(error)
      } finally {
        checking = false
      }
    }
    const checkWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void checkStatus()
    }

    ACTIVITY_EVENTS.forEach(event => window.addEventListener(event, registerActivity, { passive: true }))
    window.addEventListener('focus', checkWhenVisible)
    window.addEventListener('pageshow', checkWhenVisible)
    window.addEventListener('online', checkWhenVisible)
    document.addEventListener('visibilitychange', checkWhenVisible)
    void syncActivity()
    void checkStatus()
    const statusTimer = window.setInterval(checkWhenVisible, SESSION_STATUS_INTERVAL_MS)
    return () => {
      stopped = true
      window.clearInterval(statusTimer)
      if (activitySyncTimer) window.clearTimeout(activitySyncTimer)
      ACTIVITY_EVENTS.forEach(event => window.removeEventListener(event, registerActivity))
      window.removeEventListener('focus', checkWhenVisible)
      window.removeEventListener('pageshow', checkWhenVisible)
      window.removeEventListener('online', checkWhenVisible)
      document.removeEventListener('visibilitychange', checkWhenVisible)
    }
  }, [enabled])
}
