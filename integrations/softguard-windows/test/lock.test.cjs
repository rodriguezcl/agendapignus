const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { acquireLock } = require('../lock.cjs')
test('bloqueo Windows excluye otra ejecucion y permite la siguiente', { skip: process.platform !== 'win32' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentec-lock-'))
  let release
  try {
    release = await acquireLock(path.join(dir, 'run.guard'))
    await assert.rejects(acquireLock(path.join(dir, 'run.guard')), { code: 'LOCKED' })
    await release(); release = await acquireLock(path.join(dir, 'run.guard'))
  } finally { if (release) await release(); await fs.rm(dir, { recursive: true, force: true }) }
})
