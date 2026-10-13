const test = require('node:test')
const assert = require('node:assert/strict')
const load = () => import('../src/infrastructure/browser/fetch-pdf.mjs')

test('download keeps a valid PDF and uses session credentials without cache', async () => {
  const { fetchPdf } = await load()
  let options
  const blob = await fetchPdf('/api/vehicle-insurance/demo', { fetcher: async (_url, nextOptions) => {
    options = nextOptions
    return new Response('%PDF-1.7\nfixture', { headers: { 'content-type': 'application/pdf' } })
  } })
  assert.equal(await blob.text(), '%PDF-1.7\nfixture')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.cache, 'no-store')
})

test('HTTP errors, HTML login pages and empty responses never become PDF downloads', async () => {
  const { fetchPdf } = await load()
  await assert.rejects(fetchPdf('/pdf', { fetcher: async () => new Response(JSON.stringify({ error: 'El seguro no está cargado.' }), { status: 404, headers: { 'content-type': 'application/json' } }) }), /El seguro no está cargado/)
  await assert.rejects(fetchPdf('/pdf', { fetcher: async () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }) }), /PDF válido/)
  await assert.rejects(fetchPdf('/pdf', { fetcher: async () => new Response('', { headers: { 'content-type': 'application/pdf' } }) }), /PDF está vacío/)
})

test('a stalled download aborts and offers a retryable error', async () => {
  const { fetchPdf } = await load()
  let aborted = false
  await assert.rejects(fetchPdf('/pdf', { timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
    aborted = true
    reject(new DOMException('Aborted', 'AbortError'))
  })) }), /demoró demasiado/)
  assert.equal(aborted, true)
})
