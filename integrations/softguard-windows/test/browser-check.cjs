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
  const { exportReport, importReport, recoverPending } = require('../run.cjs')
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER || 'chrome', headless: true })
  let confirmed = 0
  let mode = 'success'
  const receipts = new Map()
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const config = { softguardUrl: 'https://softguard.pignusarg.com/', agentecUrl: 'https://agenda.pignusarg.com/', dealer: 'PIG', attempts: 1, downloadTimeoutMs: 30000, maxDropFraction: 0.1 }
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname === 'softguard.pignusarg.com' && url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div role="option" ondblclick="document.querySelector(\'iframe\').hidden=false">Administradordecuentas Administrador de cuentas</div><iframe hidden src="/sgappaccountadministration"></iframe>' })
      if (url.pathname === '/sgappaccountadministration') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<button>Filtrar</button><button onclick="document.querySelector('input').value=''">Limpiar</button><input placeholder="Dealer"><button onclick="setTimeout(()=>document.querySelector('p').textContent='Mostrando 1 - 2 de 2',100)">Buscar</button><p>Mostrando 1 - 5 de 5</p><button onclick="document.querySelector('section').hidden=false">Exportar</button><section hidden><h2>Exportar Reporte</h2><input type="checkbox" checked><a download="reporte.xls">Exportar</a><button>Cancelar</button></section><script>document.querySelector('a').href=URL.createObjectURL(new Blob(['<html><table><tr><th>Dealer/Cuenta</th><th>Nombre</th></tr><tr><td>PIG-1</td><td>Uno</td></tr><tr><td>PIG-2</td><td>Dos</td></tr></table></html>'],{type:'application/vnd.ms-excel'}))</script>` })
      if (url.pathname === '/export') return route.fulfill({ contentType: 'application/vnd.ms-excel', headers: { 'Content-Disposition': 'attachment; filename="reporte.xls"' }, body: '<html><table><tr><th>Dealer/Cuenta</th><th>Nombre</th></tr><tr><td>PIG-1</td><td>Uno</td></tr><tr><td>PIG-2</td><td>Dos</td></tr></table></html>' })
      if (url.hostname === 'agenda.pignusarg.com' && url.pathname === '/api/customers/import') {
        const body = route.request().postDataJSON()
        if (body.checkRecovery) return mode === 'old-server' ? route.fulfill({ status: 409, json: { error: 'old server' } }) : route.fulfill({ json: { recoveryProtocol: 1 } })
        if (body.resolveOperation) {
          if (mode === 'offline') return route.fulfill({ status: 503, json: { error: 'offline' } })
          return route.fulfill({ json: receipts.get(body.operationId) || { operationId: body.operationId, operationStatus: 'aborted' } })
        }
        assert.ok(body.operationId, 'Every applied import carries an operation ID')
        if (['rejected', 'offline'].includes(mode)) return route.fulfill({ status: 409, json: { error: 'revision conflict' } })
        confirmed++
        const receipt = { operationId: body.operationId, operationStatus: 'completed', revision: confirmed, customerCount: 2 }
        receipts.set(body.operationId, receipt)
        return route.fulfill({ json: mode === 'lost-response' ? {} : receipt })
      }
      if (url.hostname === 'agenda.pignusarg.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<button>Abonados y clientes</button><button onclick="document.querySelector('section').hidden=false">Importar abonados</button><section role="dialog" aria-label="Importar abonados" hidden><input type="file" onchange="document.querySelector('.import-preview').hidden=false"><div class="import-preview" hidden>2 fila(s) válidas: 0 abonado(s) nuevo(s) y 2 actualización(es).</div><button onclick="fetch('/api/customers/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:0,customers:[],responseMode:'compact-v1'})}).then(()=>document.querySelector('p').hidden=false)">Confirmar importación</button></section><p hidden>Importación confirmada y guardada. Administración puede deshacerla mientras no haya otra importación o modificación de clientes.</p>` })
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
    await recoverPending(context, config, marker)
    assert.equal(confirmed, 1, 'Recovery of a completed import never repeats the POST')
    assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'AgentecSoftguard/last-import.json'), 'utf8')).hash, report.hash)
    mode = 'lost-response'
    await importReport(context, config, report, true)
    assert.equal(confirmed, 2, 'Missing HTTP receipt is resolved from server storage')
    mode = 'rejected'
    await assert.rejects(importReport(context, config, report, true), { code: 'IMPORT_RETRY' })
    await assert.rejects(fs.access(path.join(temp, 'AgentecSoftguard/pending-import.json')), { code: 'ENOENT' })
    mode = 'offline'
    await assert.rejects(importReport(context, config, report, true), { code: 'RECOVERY_UNAVAILABLE' })
    const pending = JSON.parse(await fs.readFile(path.join(temp, 'AgentecSoftguard/pending-import.json'), 'utf8'))
    mode = 'rejected'
    await recoverPending(context, config, pending)
    await assert.rejects(fs.access(path.join(temp, 'AgentecSoftguard/pending-import.json')), { code: 'ENOENT' })
    assert.equal(confirmed, 2)
    mode = 'old-server'
    await assert.rejects(importReport(context, config, report, true), { code: 'RECOVERY_UPDATE_REQUIRED' })
    await assert.rejects(fs.access(path.join(temp, 'AgentecSoftguard/pending-import.json')), { code: 'ENOENT' })
    await assert.rejects(recoverPending(context, config, { hash: 'old' }), { code: 'IMPORT_UNCERTAIN' })
    console.log('PASS: exportación, preview sin escritura, comprobante, respuesta perdida, corte, rechazo y recuperación sin duplicados (datos sintéticos).')
  } finally { await browser.close(); await fs.rm(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

