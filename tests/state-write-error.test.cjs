const test = require('node:test')
const assert = require('node:assert/strict')
const { stateWriteError } = require('../api/_lib/state-write-error.cjs')

test('distingue espera de bloqueo y procesamiento excedido sin prometer nuevos reintentos', () => {
  const lock = stateWriteError({ code: '55P03' })
  const statement = stateWriteError({ code: '57014' })
  assert.equal(lock.status, 503)
  assert.equal(statement.status, 503)
  assert.equal(lock.code, 'DATABASE_LOCK_TIMEOUT')
  assert.equal(statement.code, 'DATABASE_STATEMENT_TIMEOUT')
  assert.match(lock.message, /otra operación/)
  assert.match(statement.message, /procesamiento/)
  assert.doesNotMatch(lock.message + statement.message, /automáticamente/)
})

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
