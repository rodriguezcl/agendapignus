'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { credentials } = require('./auth.cjs')
const { acquireLock } = require('./lock.cjs')
const home = path.join(process.env.LOCALAPPDATA, 'AgentecSoftguard')
const journal = path.join(home, 'remote-job.json')
const execute = promisify(execFile)
async function read(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
async function save(value) { await fs.writeFile(journal + '.tmp', JSON.stringify(value)); await fs.rename(journal + '.tmp', journal) }
async function main() {
  const release = await acquireLock(path.join(home, 'queue.guard'))
  let secret
  try {
    secret = await credentials('connector')
    const request = async body => {
      const response = await fetch('https://agenda.pignusarg.com/api/customers/sync/worker', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret.password}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error' })
      if (!response.ok) throw Object.assign(new Error('No se pudo comunicar el conector con Agentec.'), { status: response.status })
      return response.json()
    }
    const finish = async record => {
      try { await request({ action: 'finish', jobId: record.id, ...record.result }) }
      catch (e) { if (e.status !== 409) throw e }
      await fs.unlink(journal)
    }
    const pending = await read(journal)
    if (pending) {
      // A process interrupted before persisting its result must never repeat the import.
      await finish({ ...pending, result: pending.result || { status: 'error', code: 'WORKER_INTERRUPTED' } })
      console.log('Resultado pendiente comunicado.'); return
    }
    const { job } = await request({ action: 'poll' })
    if (!job) { console.log('PC conectada. Sin solicitudes pendientes.'); return }
    if (!/^[a-f0-9-]{36}$/.test(job.id)) throw Error('Identificador de solicitud invalido.')
    const started = Date.now()
    const record = { id: job.id, started }
    await save(record)
    let heartbeatBusy = false
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy) return
      heartbeatBusy = true
      try { await request({ action: 'heartbeat', jobId: job.id }) } catch {} finally { heartbeatBusy = false }
    }, 30000)
    let exitOk = true
    try { await execute(process.execPath, [path.join(__dirname, 'run.cjs')], { windowsHide: true, timeout: 14 * 60000, maxBuffer: 64000 }) }
    catch { exitOk = false }
    finally { clearInterval(heartbeat) }
    const result = await read(path.join(home, 'last-result.json'))
    record.result = result && Date.parse(result.at) >= started && (exitOk || result.status === 'error')
      ? { status: ['imported','unchanged'].includes(result.status) ? result.status : 'error', count: result.count, report: result.report, code: result.status === 'preview-ok' ? 'IMPORT_NOT_ENABLED' : result.code || 'WORKER_ERROR' }
      : { status: 'error', code: 'WORKER_FAILED' }
    await save(record)
    await finish(record)
    console.log('Resultado comunicado a Agentec.')
  } finally { if (secret) secret.password = ''; await release() }
}
if (require.main === module) main().catch(() => { console.error('No se completo la consulta del conector. Se reintentara en la proxima ejecucion.'); process.exitCode = 1 })
module.exports = { main }
