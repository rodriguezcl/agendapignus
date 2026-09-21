const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')

test('weekly completed service opens the read-only detail before the editing path', () => {
  const start = source.indexOf('const openTaskEditor =')
  const handler = source.slice(start, source.indexOf('const updateTaskDraft', start))
  assert.match(handler, /taskStatus\(selectedTask, day, operationalHistory\) === 'Completado'/)
  assert.ok(handler.indexOf('setCompletedService') < handler.indexOf('setTaskEditor('))
  assert.match(handler, /historyRecordForTask\(selectedTask, day, operationalHistory\)/)
  assert.match(source, /completedService && <HistoryDetail record=\{completedService\}/)
})

test('daily completed badge offers technical detail through a portal', () => {
  const badge = source.slice(source.indexOf('function TaskStatusBadge('), source.indexOf('const serviceActor ='))
  assert.match(badge, /!weekly && status === 'Completado'/)
  assert.match(badge, /Ver informe técnico/)
  assert.match(badge, /createPortal\(<HistoryDetail record=\{\{ \.\.\.task, date, \.\.\.record \}\}/)
})

test('shared read-only detail separates agenda notes from the technician report', () => {
  const detail = source.slice(source.indexOf('function HistoryDetail('), source.indexOf('function Accounts('))
  for (const field of ['record.detail', 'record.technicalObservation', 'technicalReporter(record)', 'record.technicalReportedAt']) assert.ok(detail.includes(field), field)
  assert.ok(detail.includes('Servicio informado sin observaciones adicionales.'))
  assert.doesNotMatch(detail, /Guardar cambios|persistHistoryRecord/)
})
