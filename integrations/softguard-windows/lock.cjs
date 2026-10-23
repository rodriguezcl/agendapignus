'use strict'
const { spawn } = require('node:child_process')
const path = require('node:path')
const { fail } = require('./lib.cjs')
function acquireLock(target) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Bloqueo.ps1'), '-Ruta', target], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    let ready = false, output = ''
    const timer = setTimeout(() => { child.kill(); reject(fail('LOCK_ERROR', 'No se pudo adquirir el bloqueo de ejecución.')) }, 15000)
    child.on('error', () => { clearTimeout(timer); reject(fail('LOCK_ERROR', 'No se pudo iniciar el bloqueo de ejecución.')) })
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (!ready && output.includes('READY')) {
        ready = true; clearTimeout(timer)
        resolve(() => new Promise(done => { child.once('exit', done); child.stdin.end() }))
      }
    })
    child.on('exit', () => {
      clearTimeout(timer)
      if (!ready) reject(fail('LOCKED', 'Ya hay una sincronización en curso.'))
    })
  })
}
module.exports = { acquireLock }
