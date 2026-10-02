const test = require('node:test')
const assert = require('node:assert/strict')

test('las flechas avanzan y retroceden una jornada sin domingos', async () => {
  const { shiftWeeklyAnchor } = await import('../src/domain/agenda/weekly-anchor.mjs')
  assert.equal(shiftWeeklyAnchor('2026-10-02', -1), '2026-10-01')
  assert.equal(shiftWeeklyAnchor('2026-10-02', 1), '2026-10-03')
  assert.equal(shiftWeeklyAnchor('2026-10-03', 1), '2026-10-05')
  assert.equal(shiftWeeklyAnchor('2026-10-05', -1), '2026-10-03')
  assert.equal(shiftWeeklyAnchor('2027-01-01', -1), '2026-12-31')
  assert.equal(shiftWeeklyAnchor('2026-12-31', 1), '2027-01-01')
})

test('viernes muestra cinco jornadas y continúa la semana siguiente sin domingo', async () => {
  const { weeklyVisibleDays } = await import('../src/domain/agenda/weekly-anchor.mjs')
  assert.deepEqual(weeklyVisibleDays('2026-10-02'), ['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07'])
})

test('la ventana permite consultar fechas pasadas y cruza meses y años', async () => {
  const { weeklyVisibleDays } = await import('../src/domain/agenda/weekly-anchor.mjs')
  assert.deepEqual(weeklyVisibleDays('2026-09-30'), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'])
  assert.deepEqual(weeklyVisibleDays('2026-12-31'), ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-04', '2027-01-05'])
})

test('sábado se conserva y domingo comienza en lunes', async () => {
  const { weeklyVisibleDays } = await import('../src/domain/agenda/weekly-anchor.mjs')
  assert.deepEqual(weeklyVisibleDays('2026-10-03'), ['2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'])
  assert.deepEqual(weeklyVisibleDays('2026-10-04'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'])
})

test('fechas vacías o inválidas no generan una ventana', async () => {
  const { weeklyVisibleDays } = await import('../src/domain/agenda/weekly-anchor.mjs')
  for (const date of ['', undefined, '2026-02-30', 'invalid']) assert.deepEqual(weeklyVisibleDays(date), [])
})

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
