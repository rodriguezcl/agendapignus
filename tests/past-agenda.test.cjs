const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { assertNoPastWeeklyServiceAdditions } = require('../api/_lib/past-agenda.cjs')

const agenda = tasks => ({ weekly: { '2026-09-04': { teams: [{ teamId: 'team-1', tasks }] } } })
const now = '2026-09-06T15:00:00.000Z'

test('rechaza servicios nuevos y el uso de espacios vacíos en jornadas finalizadas', () => {
  const empty = { taskId: 'slot-1', time: '14:00', service: '', client: '', detail: '' }
  assert.throws(() => assertNoPastWeeklyServiceAdditions(agenda([empty, { taskId: 'new-slot' }]), agenda([empty]), now), /jornada.*finalizó/i)
  assert.throws(() => assertNoPastWeeklyServiceAdditions(agenda([{ ...empty, serviceId: 'service-1', service: 'Service de alarma' }]), agenda([empty]), now), /jornada.*finalizó/i)
})

test('permite conservar jornadas pasadas y agregar servicios en fechas vigentes', () => {
  const existing = { taskId: 'task-1', serviceId: 'service-1', service: 'Service de alarma' }
  assert.doesNotThrow(() => assertNoPastWeeklyServiceAdditions(agenda([{ ...existing, estimatedMinutes: 60 }]), agenda([existing]), now))
  const current = { weekly: { '2026-09-06': { teams: [{ tasks: [{ taskId: 'today-new', service: 'Service' }] }] } } }
  assert.doesNotThrow(() => assertNoPastWeeklyServiceAdditions(current, { weekly: {} }, now))
})

test('la agenda semanal bloquea días finalizados, amortigua Detalle y eleva errores de modales', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /const dayHasFinished = day => String\(day \|\| ''\) < today/)
  assert.match(source, /<fieldset className="week-teams weekly-day-fields" disabled=\{finishedDay\}>/)
  assert.match(source, /<BufferedTextarea aria-required="true" value=\{task\.detail\}/)
  assert.match(styles, /body:has\(\.modal-backdrop, \.modal-layer\) \.app-shell \.content > \.notice/)
})

test('agenda diaria e historial mantienen la misma lógica operativa y visual', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /const pastDayBlocked = String\(date \|\| ''\) < currentLocalDate\(\)/)
  assert.match(source, /if \(pastDayBlocked\) \{[\s\S]*?Consultá o corregí sus servicios desde Historial/)
  assert.match(source, /internalNote: task\.internalNote \|\| '', internalChecklist: normalizeInternalChecklist\(task\.internalChecklist\)/)
  assert.match(source, /<InternalPreparationFields task=\{editing \? draft : record\} readOnly=\{!editing\}/)
  assert.match(styles, /\.task-row \.internal-checklist-item > \.icon-btn[\s\S]*?grid-column: 3 !important;[\s\S]*?grid-row: 1 !important;/)
})
