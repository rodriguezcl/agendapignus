/** Cliente único para la API local. Los módulos no deben conocer detalles de fetch. */
const STATE_ENDPOINT = '/api/state'

async function request(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`Error de API: ${response.status}`)
  return response.json()
}

export const apiClient = {
  getState: () => request(STATE_ENDPOINT),
  saveState: state => request(STATE_ENDPOINT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }),
  searchSoftguardSubscribers: ({ search = '', limit = 50, offset = 0 } = {}) => {
    const query = new URLSearchParams({ search, limit: String(limit), offset: String(offset) })
    return request(`/api/softguard/abonados?${query}`)
  }
}
