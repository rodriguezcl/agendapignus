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

test('el historial actualiza el modal sin mostrar el aviso rojo de concurrencia', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-polish.css'), 'utf8')

  assert.match(source, /const liveDetail = detail \? history\.find/)
  assert.match(source, /if \(!liveDetail\) \{ setDetail\(null\); return \}/)
  assert.match(source, /serviceRecordFingerprint\(detail\) !== serviceRecordFingerprint\(liveDetail\)/)
  assert.match(source, /acceptedFingerprintRef\.current = recordFingerprint/)
  assert.match(source, /const interactionBlocked = recordFingerprint !== acceptedFingerprintRef\.current \|\| saving/)
  assert.match(source, /disabled=\{interactionBlocked\}/)
  assert.match(source, /if \(interactionBlocked\) return/)
  assert.doesNotMatch(source, /history-concurrency-warning|Revisar versión actual|concurrently-updated/)
  assert.doesNotMatch(styles, /history-concurrency-warning|concurrently-updated/)
})
