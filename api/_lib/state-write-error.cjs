function stateWriteError(error) {
  const databaseBusy = error?.code === '55P03' || error?.code === '57014'
  if (databaseBusy) return {
    status: 503,
    message: 'La base de datos está ocupada. El sistema volverá a intentarlo automáticamente.',
    code: 'DATABASE_BUSY'
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
