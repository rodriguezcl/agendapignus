const KEY = 'pignus:pending-push'
export function rememberPush(data) {
  const pending = { noticeId: String(data.noticeId || '').slice(0, 250), userId: String(data.userId || '').slice(0, 150), at: Date.now() }
  try { sessionStorage.setItem(KEY, JSON.stringify(pending)) } catch { /* URL and event remain usable. */ }
  return pending
}
export function pendingPush() {
  const url = new URL(location.href)
  if (url.searchParams.has('pushUser')) {
    const pending = rememberPush({ noticeId: url.searchParams.get('pushNotice'), userId: url.searchParams.get('pushUser') })
    url.searchParams.delete('pushNotice'); url.searchParams.delete('pushUser')
    history.replaceState(history.state, '', url.href)
    return pending
  }
  try { const data = JSON.parse(sessionStorage.getItem(KEY)); return data && Date.now() - data.at < 15 * 60 * 1000 ? data : null } catch { return null }
}
export function clearPendingPush() { try { sessionStorage.removeItem(KEY) } catch { /* no persistent navigation */ } }
export function installPushNavigation() {
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type !== 'pignus-push-open') return
    const pending = rememberPush(event.data)
    window.dispatchEvent(new CustomEvent('pignus-push-open', { detail: pending }))
  })
}
