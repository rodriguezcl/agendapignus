const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('la huella de un servicio es estable ante el orden de las propiedades', async () => {
  const { serviceRecordChanged, serviceRecordFingerprint } = await import('../src/domain/history/service-concurrency.mjs')
  const original = { id: 'service-1', detail: 'Revisar alarma', nested: { status: 'Pendiente', values: [1, 2] } }
  const reordered = { nested: { values: [1, 2], status: 'Pendiente' }, detail: 'Revisar alarma', id: 'service-1' }

  assert.equal(serviceRecordFingerprint(original), serviceRecordFingerprint(reordered))
  assert.equal(serviceRecordChanged(original, reordered), false)
  assert.equal(serviceRecordChanged(original, { ...original, detail: 'Detalle actualizado' }), true)
  assert.equal(serviceRecordChanged(original, null), true)
})

test('el historial actualiza o cierra el modal y bloquea acciones ante cambios concurrentes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')

  assert.match(source, /const liveDetail = detail \? history\.find/)
  assert.match(source, /if \(!liveDetail\) \{ setDetail\(null\); return \}/)
  assert.match(source, /serviceRecordFingerprint\(detail\) !== serviceRecordFingerprint\(liveDetail\)/)
  assert.match(source, /className="notice history-concurrency-warning" role="alert"/)
  assert.match(source, /const interactionBlocked = concurrentChange \|\| recordFingerprint !== acceptedFingerprintRef\.current/)
  assert.match(source, /disabled=\{interactionBlocked\}/)
  assert.match(source, /if \(interactionBlocked\) return/)
})
