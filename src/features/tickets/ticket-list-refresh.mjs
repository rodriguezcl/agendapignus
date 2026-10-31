const empty = () => ({ items: [], total: 0, counts: {} })
// The table shows SLA deadlines/status, not a ticking minute counter.
const fingerprint = data => JSON.stringify(data, (key, value) => key === 'remainingMinutes' ? undefined : value)

// Keep the displayed snapshot stable while the user reads. Background results
// become visible only on request; explicit mutations refresh immediately.
export function createTicketListRefresh({ fetchList, onChange, now = Date.now, interval = 60000 }) {
  let state = { data: empty(), loading: true, refreshing: false, pending: null, error: '' }
  let current = null, disposed = false, lastStarted = -Infinity, loaded = false
  const emit = patch => { state = { ...state, ...patch }; if (!disposed) onChange(state) }
  async function refresh({ background = false } = {}) {
    if (disposed || (background && (current || now() - lastStarted < interval))) return
    current?.abort()
    const request = new AbortController()
    current = request
    lastStarted = now()
    emit({ loading: !loaded, refreshing: loaded })
    try {
      const result = await fetchList(request.signal)
      if (disposed || current !== request) return
      const data = { ...result, items: result.items || result.tickets || [] }
      if (background && loaded) {
        emit({ pending: fingerprint(data) === fingerprint(state.data) ? null : data, error: '' })
      } else {
        loaded = true
        emit({ data, pending: null, error: '' })
      }
    } catch (error) {
      if (disposed || current !== request) return
      if ([401, 403].includes(error.status)) {
        loaded = false
        emit({ data: empty(), pending: null, error: error.message })
      } else emit({ error: error.message })
    } finally {
      if (!disposed && current === request) {
        current = null
        emit({ loading: false, refreshing: false })
      }
    }
  }
  return {
    refresh,
    apply() { if (state.pending) emit({ data: state.pending, pending: null }) },
    dispose() { disposed = true; current?.abort(); current = null }
  }
}
