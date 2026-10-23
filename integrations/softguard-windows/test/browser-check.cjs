// Isolated browser fixture: never contacts SoftGuard or Agentec.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentec-connector-test-'))
  process.env.LOCALAPPDATA = temp
  await fs.mkdir(path.join(temp, 'AgentecSoftguard'))
  const { exportReport, importReport } = require('../run.cjs')
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER || 'chrome', headless: true })
  let confirmed = 0
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const config = { softguardUrl: 'https://softguard.pignusarg.com/', agentecUrl: 'https://agenda.pignusarg.com/', dealer: 'PIG', attempts: 1, downloadTimeoutMs: 5000, maxDropFraction: 0.1 }
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname === 'softguard.pignusarg.com' && url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div role="option" ondblclick="document.querySelector(\'iframe\').hidden=false">Administradordecuentas Administrador de cuentas</div><iframe hidden src="/sgappaccountadministration"></iframe>' })
      if (url.pathname === '/sgappaccountadministration') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<button>Filtrar</button><button onclick="document.querySelector('input').value=''">Limpiar</button><input placeholder="Dealer"><button onclick="setTimeout(()=>document.querySelector('p').textContent='Mostrando 1 - 2 de 2',100)">Buscar</button><p>Mostrando 1 - 5 de 5</p><button onclick="document.querySelector('section').hidden=false">Exportar</button><section hidden><h2>Exportar Reporte</h2><input type="checkbox" checked><a download="reporte.xls">Exportar</a><button>Cancelar</button></section><script>document.querySelector('a').href=URL.createObjectURL(new Blob(['<html><table><tr><th>Dealer/Cuenta</th><th>Nombre</th></tr><tr><td>PIG-1</td><td>Uno</td></tr><tr><td>PIG-2</td><td>Dos</td></tr></table></html>'],{type:'application/vnd.ms-excel'}))</script>` })
      if (url.pathname === '/export') return route.fulfill({ contentType: 'application/vnd.ms-excel', headers: { 'Content-Disposition': 'attachment; filename="reporte.xls"' }, body: '<html><table><tr><th>Dealer/Cuenta</th><th>Nombre</th></tr><tr><td>PIG-1</td><td>Uno</td></tr><tr><td>PIG-2</td><td>Dos</td></tr></table></html>' })
      if (url.hostname === 'agenda.pignusarg.com' && url.pathname === '/confirm') { confirmed++; return route.fulfill({ json: { ok: true } }) }
      if (url.hostname === 'agenda.pignusarg.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<button>Abonados y clientes</button><button onclick="document.querySelector('section').hidden=false">Importar abonados</button><section role="dialog" aria-label="Importar abonados" hidden><input type="file" onchange="document.querySelector('.import-preview').hidden=false"><div class="import-preview" hidden>2 fila(s) válidas: 0 abonado(s) nuevo(s) y 2 actualización(es).</div><button onclick="fetch('/confirm',{method:'POST'}).then(()=>document.querySelector('p').hidden=false)">Confirmar importación</button></section><p hidden>Importación confirmada y guardada. Administración puede deshacerla mientras no haya otra importación o modificación de clientes.</p>` })
      throw Error('Unexpected fixture request')
    })
    const report = await exportReport(context, config, 0, temp)
    assert.equal(report.count, 2)
    await importReport(context, config, report, false)
    assert.equal(confirmed, 0, 'Preview must not confirm')
    await importReport(context, config, report, true)
    assert.equal(confirmed, 1)
    const marker = JSON.parse(await fs.readFile(path.join(temp, 'AgentecSoftguard/pending-import.json'), 'utf8'))
    assert.equal(marker.hash, report.hash, 'Recovery marker persists until caller commits completion')
    console.log('PASS: exportación, descarga completa, vista previa sin escritura y confirmación única con marcador de recuperación (datos sintéticos).')
  } finally { await browser.close(); await fs.rm(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

