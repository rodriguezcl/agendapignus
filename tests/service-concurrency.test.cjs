const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('la huella de un servicio es estable ante el orden de las propiedades', async () => {
  const { serviceRecordChanged, serviceRecordChangedFields, serviceRecordFingerprint } = await import('../src/domain/history/service-concurrency.mjs')
  const original = { id: 'service-1', detail: 'Revisar alarma', nested: { status: 'Pendiente', values: [1, 2] } }
  const reordered = { nested: { values: [1, 2], status: 'Pendiente' }, detail: 'Revisar alarma', id: 'service-1' }

  assert.equal(serviceRecordFingerprint(original), serviceRecordFingerprint(reordered))
  assert.equal(serviceRecordChanged(original, reordered), false)
  assert.equal(serviceRecordChanged(original, { ...original, detail: 'Detalle actualizado' }), true)
  assert.equal(serviceRecordChanged(original, null), true)
  assert.deepEqual(serviceRecordChangedFields(original, { ...original, detail: 'Detalle actualizado', status: 'Completado' }), ['estado', 'detalle'])
})

test('el historial conserva el borrador y explica los cambios concurrentes sin usar una alerta roja', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const styles = [
    fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-polish.css'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'constitution-ui.css'), 'utf8')
  ].join('\n')

  assert.match(source, /const liveDetail = detail \? history\.find/)
  assert.match(source, /if \(!liveDetail\) \{ setDetail\(null\); return \}/)
  assert.match(source, /serviceRecordFingerprint\(detail\) !== serviceRecordFingerprint\(liveDetail\)/)
  assert.match(source, /const remotelyUpdated = recordFingerprint !== acceptedFingerprint/)
  assert.match(source, /const interactionBlocked = remotelyUpdated \|\| saving/)
  assert.match(source, /disabled=\{interactionBlocked\}/)
  assert.match(source, /if \(interactionBlocked\) return/)
  assert.match(source, /Hay una versión más reciente de este servicio/)
  assert.match(source, /Tu borrador permanece visible y no fue reemplazado/)
  assert.match(source, /Revisar versión actual/)
  assert.match(styles, /history-version-notice/)
})
