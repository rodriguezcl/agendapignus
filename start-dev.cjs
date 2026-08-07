const { spawn } = require('node:child_process')
const path = require('node:path')

const api = spawn(process.execPath, ['server.cjs'], { stdio: 'inherit' })
const vite = spawn(process.execPath, [path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')], { stdio: 'inherit' })

function stop() {
  api.kill()
  vite.kill()
  process.exit()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
vite.on('exit', stop)
