const test = require('node:test')
const assert = require('node:assert/strict')
const { stateWriteError } = require('../api/_lib/state-write-error.cjs')

test('los errores de restricciones internas no exponen SQL al usuario', () => {
  const result = stateWriteError(Object.assign(new Error('duplicate key value violates unique constraint "planned_teams_scope_work_date_position_key"'), { code: '23505' }))
  assert.equal(result.status, 409)
  assert.equal(result.code, 'STATE_INTEGRITY_CONFLICT')
  assert.match(result.message, /No se pudo guardar la planificación/)
  assert.doesNotMatch(result.message, /duplicate key|constraint|planned_teams/i)
})

test('conserva los conflictos funcionales que el usuario puede resolver', () => {
  const result = stateWriteError(Object.assign(new Error('El registro cambió.'), { statusCode: 409, code: 'RECORD_WRITE_CONFLICT' }))
  assert.deepEqual(result, { status: 409, message: 'El registro cambió.', code: 'RECORD_WRITE_CONFLICT' })
})
