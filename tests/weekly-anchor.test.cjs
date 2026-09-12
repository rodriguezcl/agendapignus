const test = require('node:test')
const assert = require('node:assert/strict')

test('la agenda conserva la semana vigente durante el sábado operativo', async () => {
  const { defaultWeeklyAnchor } = await import('../src/domain/agenda/weekly-anchor.mjs')
  assert.equal(defaultWeeklyAnchor(new Date('2026-09-12T14:59:00Z')), '2026-09-12')
})

test('la agenda avanza al lunes siguiente desde el sábado a las 12 en Argentina', async () => {
  const { defaultWeeklyAnchor } = await import('../src/domain/agenda/weekly-anchor.mjs')
  assert.equal(defaultWeeklyAnchor(new Date('2026-09-12T15:00:00Z')), '2026-09-14')
  assert.equal(defaultWeeklyAnchor(new Date('2026-09-13T18:00:00Z')), '2026-09-14')
})

test('la agenda vuelve a seguir el día actual desde el lunes', async () => {
  const { defaultWeeklyAnchor } = await import('../src/domain/agenda/weekly-anchor.mjs')
  assert.equal(defaultWeeklyAnchor(new Date('2026-09-14T11:00:00Z')), '2026-09-14')
})
