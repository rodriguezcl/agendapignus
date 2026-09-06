const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectFile = relative => path.resolve(__dirname, '..', relative)
const pngSize = relative => {
  const content = fs.readFileSync(projectFile(relative))
  assert.equal(content.subarray(1, 4).toString(), 'PNG')
  return [content.readUInt32BE(16), content.readUInt32BE(20)]
}

test('web y Android usan el mismo arte PNG que el acceso de iOS', () => {
  const html = fs.readFileSync(projectFile('index.html'), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(projectFile('public/manifest.webmanifest'), 'utf8'))
  assert.match(html, /rel="icon"[^>]+pignus-app-icon-192\.png\?v=2/)
  assert.match(html, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png\?v=2/)
  assert.doesNotMatch(html, /rel="icon"[^>]+favicon\.svg/)
  assert.deepEqual(manifest.icons.map(icon => [icon.src, icon.sizes]), [
    ['/pignus-app-icon-192.png?v=2', '192x192'],
    ['/pignus-app-icon-512.png?v=2', '512x512']
  ])
  assert.deepEqual(pngSize('public/apple-touch-icon.png'), [180, 180])
  assert.deepEqual(pngSize('public/pignus-app-icon-192.png'), [192, 192])
  assert.deepEqual(pngSize('public/pignus-app-icon-512.png'), [512, 512])
})

test('nota interna ocupa todo el ancho de la tarjeta en smartphones', () => {
  const styles = fs.readFileSync(projectFile('src/ui-polish.css'), 'utf8')
  const mobileRule = styles.slice(styles.indexOf('/* Nota interna debe participar'))
  assert.match(mobileRule, /\.task-row > \.internal-preparation \{[\s\S]*?grid-column: 1 \/ -1 !important;/)
  assert.match(mobileRule, /justify-self: stretch;[\s\S]*?width: 100%;[\s\S]*?box-sizing: border-box;/)
  assert.match(mobileRule, /\.internal-note-field textarea \{ display: block; \}/)
})
