const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
test('el conector conserva resultados ante cortes y no repite importaciones', async () => {
  const files = new Map(), calls = []
  let executions = 0, failFinish = true
  const home = path.join('test-home', 'AgentecSoftguard')
  const fakeFs = {
    readFile: async file => { if (!files.has(file)) throw Object.assign(Error(), { code: 'ENOENT' }); return files.get(file) },
    writeFile: async (file, value) => files.set(file, value),
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from) },
    unlink: async file => files.delete(file)
  }
  const sandbox = { module: { exports: {} }, __dirname: 'test-package', process: { env: { LOCALAPPDATA: 'test-home' }, execPath: 'node' }, console: { log() {} }, setInterval, clearInterval, AbortSignal,
    fetch: async (_, options) => {
      const body = JSON.parse(options.body); calls.push(body)
      if (body.action === 'finish' && failFinish) throw Error('network unavailable')
      return { ok: true, json: async () => body.action === 'poll' ? { job: { id: '00000000-0000-0000-0000-000000000001' } } : { ok: true } }
    },
    require: name => {
      if (name === 'node:fs/promises') return fakeFs
      if (name === './auth.cjs') return { credentials: async () => ({ password: 'synthetic' }) }
      if (name === './lock.cjs') return { acquireLock: async () => async () => {} }
      if (name === 'node:child_process') return { execFile: (_, args, options, cb) => {
        executions++
        files.set(path.join(home, 'last-result.json'), JSON.stringify({ status: 'imported', count: 1064, at: new Date(Date.now() + 2).toISOString() }))
        cb(null, '', '')
      } }
      return require(name)
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../integrations/softguard-windows/worker.cjs'), 'utf8'), sandbox)
  await assert.rejects(sandbox.module.exports.main(), /network/)
  assert.equal(executions, 1)
  assert.ok(files.has(path.join(home, 'remote-job.json')))
  failFinish = false
  await sandbox.module.exports.main()
  assert.equal(executions, 1)
  assert.equal(calls.filter(call => call.action === 'poll').length, 1)
  assert.equal(files.has(path.join(home, 'remote-job.json')), false)
})
