import { afterInteractionPaint } from '../../../presentation/pending-interaction.mjs'

function report(sample) {
  return fetch('/api/metrics/weekly-service-save', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sample),
    keepalive: true
  })
}

// The event timestamp includes time spent waiting for the browser's click
// handler. The sample ends after React has committed the success UI and the
// browser has had a chance to paint it.
export function beginWeeklyServiceSaveTiming(clickTimestamp, withAttachments, {
  doc = globalThis.document,
  clock = () => performance.now(),
  afterPaint = afterInteractionPaint,
  send = report
} = {}) {
  if (doc?.visibilityState !== 'visible') return null
  const now = clock()
  const started = Number.isFinite(clickTimestamp) && clickTimestamp > 0 && clickTimestamp <= now ? clickTimestamp : now
  let cancelled = false
  let confirmed = false
  let scheduled = false
  let retried = false

  function cancel() {
    cancelled = true
    doc.removeEventListener('visibilitychange', visibilityChanged)
    doc.defaultView?.removeEventListener('pagehide', cancel)
  }
  function visibilityChanged() {
    if (doc.visibilityState !== 'visible') cancel()
  }
  doc.addEventListener('visibilitychange', visibilityChanged)
  doc.defaultView?.addEventListener('pagehide', cancel)
  return {
    cancel,
    confirm(wasRetried) {
      confirmed = true
      retried = wasRetried
    },
    afterCommit() {
      if (cancelled || !confirmed || scheduled) return
      scheduled = true
      afterPaint().then(() => {
        if (cancelled || doc.visibilityState !== 'visible') return
        const durationMs = Math.max(1, Math.round(clock() - started))
        cancel()
        return send({ durationMs, retried, withAttachments })
      }).catch(cancel)
    }
  }
}
