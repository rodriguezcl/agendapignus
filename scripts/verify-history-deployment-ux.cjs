/* Real configuration history and deployment hook, with synthetic data and
   intercepted networking. The logout stub deliberately prevents a reload. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/ux-audit/history-deployment-fixed')
fs.mkdirSync(output, { recursive: true })
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import { createRoot } from 'react-dom/client';
${cssImports}
const auditTheme = new URLSearchParams(location.search).get('theme') || 'light';
document.body.classList.toggle('dark', auditTheme === 'dark');
const auditHistory = [{id:'audit-change',type:'teams',at:'2026-10-13T15:00:00Z',user:{name:'Administración de prueba',email:'admin@example.test'},before:[{label:'Equipo 1',technicians:['Mariano Ejemplo','Rodrigo Ejemplo']},{label:'Equipo 2',technicians:['Pascual Ejemplo']}],after:[{label:'Equipo 1',technicians:['Mariano Ejemplo','Pascual Ejemplo']},{label:'Equipo 2',technicians:['Rodrigo Ejemplo']}]}];
function DeploymentAuditFixture() {
  const [flags, setFlags] = useState({ pending: true, domBusy: false, busy: false });
  const guard = useRef(null);
  useEffect(() => { window.setAuditFlags = patch => setFlags(previous => ({...previous,...patch})); }, []);
  useDeploymentUpdate({active:true,busy:flags.busy,guard,logout:async options => {
    window.auditLogouts.push(options);
    throw new Error('Salida de prueba interceptada; no se recargó la página.');
  }});
  return <main className="technician-page" data-unsaved-attachments={flags.pending || undefined} aria-busy={flags.domBusy || undefined}><section className="technician-content"><p className="eyebrow">PRUEBA LOCAL</p><h1>Servicios asignados</h1><article className="technician-service"><h2>Control semanal de vehículo</h2><p>Renault Kangoo · AB123CD</p><p>Foto seleccionada y todavía sin guardar.</p></article></section></main>;
}
window.auditLogouts = [];
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('case') === 'history'
 ? <div className="app-shell" data-theme={auditTheme}><div className="modal-backdrop monthly-backdrop"><section className="modal monthly-teams-modal" role="dialog" aria-label="Equipos de octubre"><p className="eyebrow">CONFIGURACIÓN MENSUAL</p><h2>Equipos de octubre de 2026</h2><ConfigurationHistoryPanel history={auditHistory} type="teams" /></section></div></div>
 : <DeploymentAuditFixture />);
`
const built = buildSync({ stdin: { contents: source + '\n' + fixture, resolveDir: path.join(root, 'src'), loader: 'jsx' }, bundle: true, write: false, outdir: 'out', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'true', '__APP_BUILD_ID__': '"audit-old"' }, external: ['/logo-pignus.png'], loader: { '.css': 'css' }, logLevel: 'silent' })
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'

function contrast(foreground, background) {
  const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      const errors = [], requests = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname !== 'history-deployment.test') return route.abort()
        requests.push(url.pathname)
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/version.json') return route.fulfill({ json: { buildId: 'audit-new' } })
        return route.abort()
      })
      const colors = async selector => page.locator(selector).evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node)
        let background = style.backgroundColor, parent = node.parentElement
        while (background === 'rgba(0, 0, 0, 0)' && parent) { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement }
        return { text: node.textContent, color: style.color, background, width: node.getBoundingClientRect().width, left: node.getBoundingClientRect().left }
      }))
      await page.goto(`https://history-deployment.test/?case=history&theme=${theme}`)
      await page.locator('.configuration-history > summary').click()
      assert.equal(await page.locator('.configuration-history-list section').count(), 2)
      assert.equal(await page.locator('.configuration-history-list strong').first().textContent(), 'Antes')
      assert.equal(await page.locator('.configuration-history-list strong').last().textContent(), 'Después')
      const historyColors = await colors('.configuration-history-list section, .configuration-history-list strong, .configuration-history-list p, .configuration-history-list header span')
      for (const item of historyColors) {
        assert.ok(contrast(item.color, item.background) >= 4.5, `Low history text contrast: ${JSON.stringify(item)}`)
        if (theme === 'dark') {
          const channels = item.background.match(/\d+/g).slice(0, 3).map(Number)
          assert.equal(Math.max(...channels) - Math.min(...channels), 0, `History background must be neutral: ${item.background}`)
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
      await page.screenshot({ path: path.join(output, `configuration-history-${theme}-390.png`) })

      await page.goto(`https://history-deployment.test/?case=deployment&theme=${theme}`)
      const banner = page.locator('.deployment-update-banner')
      await banner.getByText('Guardá las fotos o los archivos pendientes antes de actualizar.', { exact: false }).waitFor()
      assert.equal(await page.evaluate(() => window.auditLogouts.length), 0, 'Detection must retain unsaved photos')
      const button = banner.getByRole('button', { name: 'Actualizar', exact: true })
      await button.click();await page.waitForTimeout(160)
      assert.equal(await page.evaluate(() => window.auditLogouts.length), 0, 'Manual update must retain unsaved photos')
      const bannerColors = await colors('.deployment-update-banner, .deployment-update-banner b, .deployment-update-banner p')
      for (const item of bannerColors) {
        assert.ok(contrast(item.color, item.background) >= 4.5, `Low banner contrast: ${JSON.stringify(item)}`)
        assert.ok(item.left >= 0 && item.left + item.width <= 390)
        if (theme === 'dark') {
          const channels = item.background.match(/\d+/g).slice(0, 3).map(Number)
          assert.equal(Math.max(...channels) - Math.min(...channels), 0)
        }
      }
      await page.screenshot({ path: path.join(output, `deployment-pending-${theme}-390.png`) })
      await page.evaluate(() => window.setAuditFlags({ pending: false, domBusy: true }))
      await page.locator('.technician-page[aria-busy="true"]').waitFor()
      await button.click();await page.waitForTimeout(160)
      assert.equal(await page.evaluate(() => window.auditLogouts.length), 0, 'An attachment operation must block an update')
      await page.evaluate(() => window.setAuditFlags({ domBusy: false, busy: true }))
      await page.waitForFunction(() => document.querySelector('.deployment-update-banner button').disabled)
      assert.equal(await page.evaluate(() => window.auditLogouts.length), 0, 'Application persistence must also block update')
      await page.evaluate(() => window.setAuditFlags({ busy: false }))
      await page.waitForFunction(() => !document.querySelector('.deployment-update-banner button').disabled)
      await button.click()
      await banner.getByText('Salida de prueba interceptada; no se recargó la página.', { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.auditLogouts), [{ requireServerLogout: true }])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
      assert.deepEqual(errors, [])
      assert.equal(requests.filter(request => request === '/version.json').length, 1)
      results.push({ theme, width: 390, historyColors, bannerColors, checks: ['before-after-visible', 'contrast-4.5', 'neutral-dark-surfaces', 'pending-blocks-auto-update', 'pending-blocks-manual-update', 'attachment-busy-blocks', 'app-busy-disables', 'clean-manual-update-calls-logout-once'], errors, requests })
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
      console.log(`${theme} 390 PASS`)
      await context.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
