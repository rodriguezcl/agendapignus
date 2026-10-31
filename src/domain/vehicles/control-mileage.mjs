// The scheduling snapshot is historical; only the fleet value can validate a new report.
export function controlMileage(vehicle, input) {
  const current = vehicle && (vehicle.mileage == null || vehicle.mileage === '' ? 0 : Number(vehicle.mileage))
  const ready = Boolean(vehicle) && Number.isInteger(current) && current >= 0
  const value = String(input ?? '')
  let error = ''
  if (!ready) error = 'No se pudo consultar el kilometraje actual. Actualizá la agenda antes de informar el control.'
  else if (value && (!/^\d+$/.test(value) || Number(value) > 99999999)) error = 'Ingresá un kilometraje entero válido, sin puntos ni comas.'
  else if (value && Number(value) <= current) error = `El kilometraje debe ser superior a ${current.toLocaleString('es-AR')} km. Si el valor registrado es incorrecto, solicitá su corrección en Flota a Administración.`
  return { current, ready, error, valid: ready && Boolean(value) && !error }
}
