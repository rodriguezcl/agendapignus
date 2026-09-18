const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const start = source.indexOf('const agendaServiceProgress =')
const progress = vm.runInNewContext(source.slice(start, source.indexOf('function TaskStatusBadge', start)) + '\nagendaServiceProgress')
const startedAt = '2026-09-18T14:32:00.000Z'

test('confirmed technician start displays En proceso and Argentina local start time', () => {
  const record = { status: 'Pendiente', startedAt }
  const result = progress(record, record.status)
  assert.equal(result.status, 'En proceso')
  assert.equal(result.startedLabel, 'Inició a las 11:32')
  assert.equal(record.status, 'Pendiente', 'display must not alter persisted workflow status')
})

test('unstarted, invalid, unsaved and vehicle tasks do not become in progress', () => {
  for (const [record, status] of [[null, 'Sin guardar'], [{}, 'Pendiente'], [{ startedAt: 'invalid' }, 'Pendiente'], [{ startedAt, vehicleControl: true }, 'Pendiente']]) {
    assert.equal(progress(record, status).status, status)
    assert.equal(progress(record, status).startedLabel, '')
  }
})

test('closing and technician reports take precedence over the previous start', () => {
  for (const status of ['Completado', 'Cancelado', 'Reprogramado', 'Requiere revisión']) {
    assert.equal(progress({ startedAt, status }, status).status, status)
    assert.equal(progress({ startedAt, status }, status).startedLabel, '')
  }
  for (const technicalStatus of ['Completado', 'Cancelado', 'Reprogramación solicitada']) {
    assert.equal(progress({ startedAt, technicalStatus }, 'Pendiente').status, 'Pendiente')
    assert.equal(progress({ startedAt, technicalStatus }, 'Pendiente').startedLabel, '')
  }
})

test('daily and weekly badges use the authoritative history record and show start time', () => {
  const badge = source.slice(source.indexOf('function TaskStatusBadge'), source.indexOf('const serviceActor'))
  assert.match(badge, /agendaServiceProgress\(record, taskStatus\(task, date, history\)\)/)
  assert.match(badge, /historyRecordForTask\(task, date, history\)/)
  assert.match(badge, /service-started-label/)
  assert.match(source, /<TaskStatusBadge task=\{task\} date=\{date\} history=\{history\} \/>/)
  assert.match(source, /<TaskStatusBadge task=\{task\} date=\{day\} history=\{operationalHistory\} weekly \/>/)
})
