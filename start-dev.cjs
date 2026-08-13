const { spawn } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')

const apiPort = Number(process.env.PIGNUS_PORT || 3001)
const webPort = Number(process.env.PIGNUS_WEB_PORT || 5173)
let api = null
let vite = null
let stopping = false

function isHttpReady(port, pathname = '/') {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 500 }, response => {
      response.resume()
      resolve(true)
    })
    request.on('timeout', () => { request.destroy(); resolve(false) })
    request.on('error', () => resolve(false))
  })
}

async function waitForApi(attempt = 0) {
  if (await isHttpReady(apiPort, '/api/auth/session')) return true
  if (attempt >= 100) return false
  await new Promise(resolve => setTimeout(resolve, 100))
  return waitForApi(attempt + 1)
}

async function start() {
  const existingApi = await isHttpReady(apiPort, '/api/auth/session')
  if (existingApi) {
    console.log(`La base de datos ya está activa en http://127.0.0.1:${apiPort}`)
  } else {
    api = spawn(process.execPath, ['server.cjs'], { stdio: 'inherit' })
    api.on('exit', stop)
    if (!await waitForApi()) return stop()
  }

  if (await isHttpReady(webPort)) {
    console.log(`Agenda técnica ya está activa en http://127.0.0.1:${webPort}`)
    if (!api) process.exit(0)
    return
  }

  vite = spawn(process.execPath, [
    path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1',
    '--port', String(webPort),
    '--strictPort'
  ], { stdio: 'inherit' })
  vite.on('exit', stop)
}

function stop() {
  if (stopping) return
  stopping = true
  api?.kill()
  vite?.kill()
  process.exit()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
start().catch(error => { console.error(error); stop() })
