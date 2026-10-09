const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')

test('weekly completed service opens the read-only detail before the editing path', () => {
  const start = source.indexOf('const openTaskEditor =')
  const handler = source.slice(start, source.indexOf('const updateTaskDraft', start))
  assert.match(handler, /\['Completado', 'Avance registrado'\]\.includes\(taskStatus\(selectedTask, day, operationalHistory\)\)/)
  assert.ok(handler.indexOf('setCompletedService') < handler.indexOf('setTaskEditor('))
  assert.match(handler, /historyRecordForTask\(selectedTask, day, operationalHistory\)/)
  assert.match(source, /completedService && <HistoryDetail\b[^>]*record=\{completedService\}/)
})

test('daily completed badge offers a collapsed technical disclosure', () => {
  const badge = source.slice(source.indexOf('function TaskStatusBadge('), source.indexOf('const serviceActor ='))
  assert.match(badge, /!weekly && \['Completado', 'Avance registrado'\]\.includes\(status\)/)
  assert.match(badge, /Ver informe técnico/)
  assert.match(badge, /<details className="agenda-report-disclosure"/)
  assert.doesNotMatch(badge, /<details[^>]*\sopen[\s=>]/)
  assert.match(badge, /Ocultar informe técnico/)
})

test('shared read-only detail separates agenda notes from the technician report', () => {
  const detail = source.slice(source.indexOf('function HistoryDetail('), source.indexOf('function Accounts('))
  for (const field of ['record.detail', 'record.technicalObservation', 'technicalReporter(record)', 'record.technicalReportedAt']) assert.ok(detail.includes(field), field)
  assert.ok(detail.includes('Servicio informado sin observaciones adicionales.'))
  assert.doesNotMatch(detail, /Guardar cambios|persistHistoryRecord/)
})

test('both agendas expose reported requests regardless of completed status', () => {
  const badge = source.slice(source.indexOf('function TaskStatusBadge('), source.indexOf('const serviceActor ='))
  assert.match(badge, /\|\| Boolean\(record\?\.technicalStatus \|\| record\?\.technicalObservation \|\| record\?\.technicalReportedAt\)/)
  assert.match(badge, /onClick=\{event => event.stopPropagation\(\)\}/)
})

test('technical notes remain in modals and inside the expandable card section', () => {
  const badge = source.slice(source.indexOf('function TaskStatusBadge('), source.indexOf('const serviceActor ='))
  assert.match(badge, /<AgendaTechnicalNote record=\{record \|\| task\} \/><\/details>/)
  assert.match(source, /<AgendaTechnicalNote record=\{historyRecordForTask\(task, day, operationalHistory\) \|\| taskEditor.baseRecord\}/)
  assert.match(source, /detail-notes customer-history-technical technician-report-detail agenda-technical-note/)
})

test('disclosure includes administration context and weekly cards do not hide it', () => {
  const badge = source.slice(source.indexOf('function TaskStatusBadge('), source.indexOf('const serviceActor ='))
  assert.match(badge, /Observación de agenda \/ Administración/)
  assert.ok(badge.indexOf('agenda-admin-note') < badge.indexOf('<AgendaTechnicalNote'))
  const css = fs.readFileSync(path.join(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  assert.match(css, /:not\(\.agenda-report-disclosure\)/)
  const modal = source.slice(source.indexOf('{taskEditor && (() => {'), source.indexOf('<div className="weekly-scroll-top"'))
  assert.ok(modal.indexOf('value={task.detail}') < modal.indexOf('<AgendaTechnicalNote'))
})
