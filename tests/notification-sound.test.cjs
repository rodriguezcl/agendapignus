const test = require('node:test')
const assert = require('node:assert/strict')
const notice = (id, type = 'collection', extra = {}) => ({ id, target: { type }, ...extra })

test('silencia la carga inicial de cada origen y detecta novedades sin depender del contador', async () => {
  const { createNotificationSoundTracker } = await import('../src/domain/dashboard/notification-sound.mjs')
  const next = createNotificationSoundTracker()
  const initial = [notice('collection:1')]
  assert.equal(next(initial, { operational: true }), false)
  const loaded = [...initial, notice('ticket:1', 'ticket'), notice('password:1', 'password-reset')]
  assert.equal(next(loaded), false)
  assert.equal(next([...loaded].reverse()), false)
  assert.equal(next([notice('collection:2'), ...loaded.slice(1)]), true)
  assert.equal(next([notice('collection:2', 'collection', { detail: 'Corrección de monto' }), ...loaded.slice(1)]), false)
  assert.equal(next([]), false)
  assert.equal(next(loaded), false)
})

test('un nuevo integrante de un grupo genera aviso aunque se conserve el total', async () => {
  const { createNotificationSoundTracker } = await import('../src/domain/dashboard/notification-sound.mjs')
  const next = createNotificationSoundTracker()
  const group = soundKeys => [notice('pending:today', 'history', { soundKeys })]
  assert.equal(next(group(['a', 'b'])), false)
  assert.equal(next(group(['b'])), false)
  assert.equal(next(group(['c'])), true)
  assert.equal(next(group(['c'])), false)
})

test('no confunde reactivación de una fuente o nueva sesión con avisos nuevos', async () => {
  const { createNotificationSoundTracker } = await import('../src/domain/dashboard/notification-sound.mjs')
  const next = createNotificationSoundTracker()
  assert.equal(next([notice('a')]), false)
  assert.equal(next([], { operational: false }), false)
  assert.equal(next([notice('b')]), false)
  assert.equal(next([notice('b'), notice('c')]), true)
  assert.equal(createNotificationSoundTracker()([notice('b'), notice('c')]), false)
})

test('el audio respeta activación del navegador, reproduce un tono breve y libera recursos', async () => {
  const { createNotificationChime } = await import('../src/infrastructure/browser/notification-chime.mjs')
  const oscillators = [], values = []
  let resumed = 0, closed = 0
  class AudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 1; this.destination = {} }
    async resume() { resumed++; this.state = 'running' }
    async close() { closed++; this.state = 'closed' }
    createOscillator() { const node = { frequency: { setValueAtTime: value => values.push(value) }, connect() {}, disconnect() {}, start(time) { this.startAt = time }, stop(time) { this.stopAt = time } }; oscillators.push(node); return node }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} } }
  }
  const chime = createNotificationChime({ AudioContext })
  assert.equal(chime.play(), false)
  assert.equal(await chime.unlock(), true)
  assert.equal(chime.play(), true)
  assert.equal(resumed, 1)
  assert.equal(oscillators.length, 2)
  assert.deepEqual(values, [660, 880])
  assert(oscillators.every(node => node.stopAt - node.startAt < 0.3))
  chime.dispose()
  assert.equal(closed, 1)
  assert.equal(chime.play(), false)
  assert.equal(await createNotificationChime({}).unlock(), false)
})
