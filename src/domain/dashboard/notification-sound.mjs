export const notificationSource = notice => notice.target?.type === 'ticket' ? 'tickets' : notice.target?.type === 'password-reset' ? 'password' : 'operational'

// Track identities, not text or counts: resolving a notice is not a new event.
// Each independent request establishes its own silent initial snapshot.
export function createNotificationSoundTracker() {
  const initialized = new Set(), seen = new Set()
  return (notifications, ready = { operational: true, tickets: true, password: true }) => {
    let arrivals = 0
    for (const source of ['operational', 'tickets', 'password']) {
      if (!ready[source]) { initialized.delete(source); continue }
      for (const notice of notifications.filter(item => notificationSource(item) === source)) {
        const keys = notice.soundKeys || [notice.id]
        for (const key of keys) {
          const identity = `${source}:${key}`
          if (initialized.has(source) && !seen.has(identity)) arrivals++
          seen.add(identity)
        }
      }
      initialized.add(source)
    }
    return arrivals > 0
  }
}
