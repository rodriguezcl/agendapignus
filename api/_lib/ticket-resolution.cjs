const RESOLUTION_METHODS = Object.freeze({
  phone: 'Llamada',
  chat: 'Chat',
  email: 'Correo',
  onsite: 'Visita técnica',
  other: 'Otra gestión'
})

function resolutionMethod(value) {
  // Las integraciones anteriores pueden omitir el medio; nunca se infiere una
  // llamada o visita a partir de la categoría o del origen de la solicitud.
  if (value === undefined) return ''
  if (typeof value !== 'string' || !Object.hasOwn(RESOLUTION_METHODS, value)) {
    const error = new Error('Seleccioná un medio de resolución válido.')
    error.statusCode = 400
    throw error
  }
  return value
}

module.exports = { RESOLUTION_METHODS, resolutionMethod }
