const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')

test('actualizar recarga sin cerrar sesión y protege borradores y guardados', async () => {
  const { requestManualRefresh } = await import('../src/features/state/application/manual-refresh.mjs')
  let reloads = 0, confirmations = 0, notices = 0
  const options = { busy: false, dirty: false, online: true, reload: () => reloads++, notify: () => notices++, confirm: () => { confirmations++; return false } }
  assert.equal(requestManualRefresh(options), true)
  assert.equal(reloads, 1)
  assert.equal(confirmations, 0)
  assert.equal(requestManualRefresh({ ...options, dirty: true }), false)
  assert.equal(reloads, 1)
  assert.equal(requestManualRefresh({ ...options, dirty: true, confirm: () => true }), true)
  assert.equal(reloads, 2)
  assert.equal(requestManualRefresh({ ...options, busy: true }), false)
  assert.equal(requestManualRefresh({ ...options, online: false }), false)
  assert.equal(reloads, 2)
  assert.equal(notices, 2)
})

test('todas las cabeceras con cierre de sesión tienen Actualizar y el control es accesible en móvil', () => {
  const root = path.resolve(__dirname, '..')
  for (const file of ['src/App.jsx', 'src/HelpCenter.jsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const logoutButtons = [...source.matchAll(/<button\b[^>]*className="logout-button"/g)]
    assert.ok(logoutButtons.length)
    for (const button of logoutButtons) assert.ok(source.slice(0, button.index).endsWith('<RefreshButton />'))
  }
  const button = fs.readFileSync(path.join(root, 'src/components/ui/RefreshButton.jsx'), 'utf8')
  assert.match(button, /aria-label="Actualizar página"/)
  assert.doesNotMatch(button, /logout|\/api\/auth/)
  const css = fs.readFileSync(path.join(root, 'src/components/ui/refresh-button.css'), 'utf8')
  assert.match(css, /min-height: 44px/)
  assert.match(css, /max-width: 640px/)
})
