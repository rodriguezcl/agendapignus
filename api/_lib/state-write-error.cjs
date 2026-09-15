function stateWriteError(error) {
  if (error?.code === '55P03') return {
    status: 503,
    message: 'El guardado esperó demasiado a que terminara otra operación. Intentá guardar nuevamente.',
    code: 'DATABASE_LOCK_TIMEOUT'
  }
  if (error?.code === '57014') return {
    status: 503,
    message: 'El procesamiento del guardado excedió el tiempo permitido. Intentá guardar nuevamente. Si se repite, informá a Administración.',
    code: 'DATABASE_STATEMENT_TIMEOUT'
  }
  const databaseConstraint = error?.code === '23505' || /duplicate key value|unique constraint/i.test(String(error?.message || ''))
  if (databaseConstraint) return {
    status: 409,
    message: 'No se pudo guardar la planificación por una inconsistencia interna. Recargá la página antes de reintentar.',
    code: 'STATE_INTEGRITY_CONFLICT'
  }
  return {
    status: error?.statusCode || 400,
    message: error?.message || 'No se pudieron guardar los datos.',
    code: error?.code
  }
}

module.exports = { stateWriteError }
