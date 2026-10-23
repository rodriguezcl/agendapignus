'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const readline = require('node:readline/promises')
const { chromium } = require('playwright')
const { fail, validateReport, retryDownload } = require('./lib.cjs')
const { ensureSession } = require('./auth.cjs')
const { acquireLock } = require('./lock.cjs')
const home = path.join(process.env.LOCALAPPDATA || os.homedir(), 'AgentecSoftguard')
const file = name => path.join(home, name)
const args = new Set(process.argv.slice(2))
const diagnostic = args.has('--diagnostic')
const stage = message => { if (diagnostic) console.log(message) }
async function inspectFailure(page, error) {
  if (!diagnostic) return
  console.log(`Diagnostico detenido: ${error.code || 'AUTOMATION_ERROR'}`)
  try { const url = new URL(page.url()); console.log(`Pantalla: ${url.origin}${url.pathname}`) } catch {}
  const input = readline.createInterface({ input: process.stdin, output: process.stdout })
  try { await input.question('Observa la pantalla y anota cualquier aviso. No confirmes importaciones. Presiona Enter aqui para cerrar.\n') } finally { input.close() }
}
const read = async (name, fallback) => {
  try { return JSON.parse(await fs.readFile(file(name), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return fallback; throw e }
}
const write = async (name, value) => {
  await fs.writeFile(file(name + '.tmp'), JSON.stringify(value, null, 2), { mode: 0o600 })
  await fs.rename(file(name + '.tmp'), file(name))
}
async function openAccounts(page, config) {
  stage('1. Abriendo SoftGuard...')
  await page.goto(config.softguardUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
  const shortcut = page.getByRole('option', { name: 'Administradordecuentas Administrador de cuentas', exact: true })
  await ensureSession(page, 'softguard', shortcut)
  stage('2. Acceso listo. Abriendo Administrador de cuentas...')
  await shortcut.dblclick()
  const frame = page.frameLocator('iframe[src*="sgappaccountadministration"]')
  await frame.getByText('Filtrar', { exact: true }).click()
  await frame.getByText('Limpiar', { exact: true }).click()
  await frame.getByPlaceholder('Dealer', { exact: true }).fill(config.dealer)
  await frame.getByText('Buscar', { exact: true }).click()
  stage('3. Filtro PIG solicitado. Leyendo total...')
  const total = frame.getByText(/^Mostrando\s+\d+\s*-\s*\d+\s+de\s+[\d.]+$/)
  await total.waitFor({ timeout: 30000 })
  const text = await total.innerText()
  const count = Number(text.match(/de\s+([\d.]+)$/)[1].replace(/\./g, ''))
  if (!count) throw fail('NO_ACCOUNTS', 'SoftGuard no informa cuentas para exportar.')
  return { frame, count, total }
}
async function exportReport(context, config, previousCount, runDir) {
  return retryDownload(async attempt => {
    // Fresh page per attempt: a late download from a prior attempt cannot be reused.
    const page = await context.newPage()
    try {
      const { frame, count, total } = await openAccounts(page, config)
      stage(`4. Total inicial: ${count} (se verificara al finalizar). Abriendo opciones de exportacion...`)
      await frame.getByText('Exportar', { exact: true }).filter({ visible: true }).click()
      // The toolbar opens a second confirmation window. Preserve all defaults.
      const exportWindow = frame.getByText('Exportar Reporte', { exact: true })
        .locator('xpath=ancestor::*[.//*[normalize-space(.)="Cancelar"]][1]')
      await exportWindow.waitFor({ state: 'visible', timeout: 20000 })
      const pending = page.waitForEvent('download', { timeout: config.downloadTimeoutMs })
      pending.catch(() => {})
      stage('4b. Confirmando Exportar Reporte sin cambiar las casillas...')
      await exportWindow.getByText('Exportar', { exact: true }).click()
      let download
      try { download = await pending } catch { throw fail('DOWNLOAD_TIMEOUT', 'SoftGuard no entregó el archivo a tiempo.', true) }
      stage('5. Descarga iniciada. Esperando archivo completo...')
      const target = path.join(runDir, `reporte-${attempt}.xls`)
      let timeout
      try {
        await Promise.race([
          download.saveAs(target),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(fail('DOWNLOAD_TIMEOUT', 'La descarga no terminó a tiempo.', true)), config.downloadTimeoutMs) })
        ])
      } catch (e) { await download.cancel().catch(() => {}); throw fail(e.code || 'DOWNLOAD_FAILED', 'No se pudo completar la descarga.', true) }
      finally { clearTimeout(timeout) }
      // Search refresh is asynchronous: do not validate against the pre-filter total.
      const finalCount = Number((await total.innerText()).match(/de\s+([\d.]+)$/)?.[1].replace(/\./g, ''))
      stage(`5b. Total final del listado: ${finalCount}. Validando archivo...`)
      const report = validateReport(await fs.readFile(target), { expectedCount: finalCount, dealer: config.dealer, previousCount, maxDropFraction: config.maxDropFraction })
      return { ...report, target, attempt }
    } catch (error) { await inspectFailure(page, error); throw error
    } finally { await page.close().catch(() => {}) }
  }, { attempts: config.attempts, onRetry: (attempt, code) => console.log(`Reintento ${attempt}: ${code}`) })
}
async function importReport(context, config, report, apply) {
  const page = await context.newPage()
  try {
    stage('6. Abriendo Agentec para validar la vista previa...')
    await page.goto(config.agentecUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await ensureSession(page, 'agentec', page.getByRole('button', { name: 'Abonados y clientes', exact: true }))
    try { await page.getByRole('button', { name: 'Abonados y clientes', exact: true }).click({ timeout: 20000 }) }
    catch { throw fail('AGENTEC_ACCESS', 'Revisá la sesión y los permisos de Abonados y clientes en Agentec.') }
    await page.getByRole('button', { name: 'Importar abonados', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Importar abonados', exact: true })
    await modal.locator('input[type="file"]').setInputFiles(report.target)
    const preview = modal.locator('.import-preview')
    await preview.waitFor({ timeout: 20000 })
    const count = Number((await preview.innerText()).match(/(\d+) fila\(s\) válidas/)?.[1])
    if (count !== report.count) throw fail('PREVIEW_MISMATCH', 'La vista previa de Agentec no coincide con el reporte.')
    if (!apply) return
    // Write-ahead marker: an ambiguous POST is never automatically repeated.
    await write('pending-import.json', { hash: report.hash, count: report.count, at: new Date().toISOString() })
    await modal.getByRole('button', { name: 'Confirmar importación', exact: true }).click()
    try { await page.getByText('Importación confirmada y guardada. Administración puede deshacerla mientras no haya otra importación o modificación de clientes.', { exact: true }).waitFor({ timeout: 65000 }) }
    catch { throw fail('IMPORT_UNCERTAIN', 'No se pudo confirmar el resultado. Revisá la auditoría de Agentec antes de habilitar otro intento.') }
  } catch (error) { await inspectFailure(page, error); throw error
  } finally { await page.close().catch(() => {}) }
}
async function main() {
  await fs.mkdir(home, { recursive: true })
  const releaseLock = await acquireLock(file('run.guard'))
  let context, runDir
  try {
    const config = await read('config.json', null)
    if (!config) throw fail('CONFIG', 'Primero ejecutá Instalar.ps1.')
    if (config.softguardUrl !== 'https://softguard.pignusarg.com/' || config.agentecUrl !== 'https://agenda.pignusarg.com/' || config.dealer !== 'PIG') throw fail('CONFIG', 'Origen, destino o dealer inesperados.')
    if (!Number.isInteger(config.attempts) || config.attempts < 1 || config.attempts > 3 || !Number.isFinite(config.downloadTimeoutMs) || config.downloadTimeoutMs < 1000 || config.downloadTimeoutMs > 120000 || !Number.isFinite(config.maxDropFraction) || config.maxDropFraction < 0 || config.maxDropFraction > 0.5) throw fail('CONFIG', 'Límites de ejecución inválidos.')
    if (args.has('--status')) { console.log(JSON.stringify(await read('last-result.json', { status: 'sin ejecuciones' }), null, 2)); return }
    if (args.has('--enable')) {
      const preview = await read('last-result.json', {})
      const previewAge = Date.now() - Date.parse(preview.at)
      if (preview.status !== 'preview-ok' || !Number.isFinite(previewAge) || previewAge < 0 || previewAge > 86400000) throw fail('PREVIEW_REQUIRED', 'Primero ejecutá una prueba completa, dentro de las últimas 24 horas.')
      if (await read('pending-import.json', null)) throw fail('IMPORT_UNCERTAIN', 'Hay una importación pendiente de revisión.')
      await write('config.json', { ...config, importEnabled: true }); console.log('Importación automática habilitada.'); return
    }
    if (await read('pending-import.json', null)) throw fail('IMPORT_UNCERTAIN', 'Hay una importación pendiente de revisión; no se repetirá automáticamente.')
    if (diagnostic) { config.attempts = 1; console.log('DIAGNOSTICO VISIBLE: un intento, sin importar datos.') }
    context = await chromium.launchPersistentContext(file('browser-profile'), { channel: 'chrome', headless: !args.has('--login') && !diagnostic, acceptDownloads: true, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' })
    context.setDefaultTimeout(20000)
    if (args.has('--login')) {
      await (await context.newPage()).goto(config.softguardUrl)
      await (await context.newPage()).goto(config.agentecUrl)
      const input = readline.createInterface({ input: process.stdin, output: process.stdout })
      try { await input.question('Iniciá sesión en ambos sitios. No guardes contraseñas en el código. Volvé aquí y presioná Enter al terminar.\n') } finally { input.close() }
      return
    }
    runDir = await fs.mkdtemp(path.join(home, 'download-'))
    const last = await read('last-import.json', {})
    const report = await exportReport(context, config, last.count || 0, runDir)
    const apply = config.importEnabled === true && !args.has('--preview') && !diagnostic
    if (apply && last.hash === report.hash) {
      await write('last-result.json', { status: 'unchanged', at: new Date().toISOString(), count: report.count }); return
    }
    await importReport(context, config, report, apply)
    if (apply) {
      await write('last-import.json', { hash: report.hash, count: report.count, at: new Date().toISOString() })
      await fs.unlink(file('pending-import.json'))
    }
    await write('last-result.json', { status: apply ? 'imported' : 'preview-ok', at: new Date().toISOString(), count: report.count, attempts: report.attempt })
    console.log(apply ? 'Sincronización confirmada.' : 'Prueba correcta. No se importaron datos.')
  } catch (e) {
    await write('last-result.json', { status: 'error', at: new Date().toISOString(), code: e.code || 'AUTOMATION_ERROR', message: e.code ? e.message : 'Cambió la pantalla o falló el navegador. Revisá las sesiones y repetí la prueba.' })
    throw e
  } finally {
    try {
      await context?.close().catch(() => {})
      if (runDir) await fs.rm(runDir, { recursive: true, force: true })
    } finally { await releaseLock() }
  }
}
if (require.main === module) main().catch(e => { console.error(e.code || 'AUTOMATION_ERROR', e.code ? e.message : 'Revisá el estado de la sincronización.'); process.exitCode = 1 })
module.exports = { openAccounts, exportReport, importReport }
