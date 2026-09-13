const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

export const serviceRecordFingerprint = record => JSON.stringify(canonical(record || null))

export const serviceRecordChanged = (openedRecord, currentRecord) => serviceRecordFingerprint(openedRecord) !== serviceRecordFingerprint(currentRecord)

const visibleFields = [
  ['status', 'estado'], ['date', 'fecha'], ['time', 'hora'],
  ['customerId', 'cliente'], ['client', 'cliente'],
  ['serviceId', 'tipo de servicio'], ['service', 'tipo de servicio'],
  ['technicianIds', 'técnicos asignados'], ['teamId', 'equipo'],
  ['address', 'dirección'], ['phone', 'contacto'],
  ['detail', 'detalle'], ['internalNote', 'nota interna']
]

export const serviceRecordChangedFields = (openedRecord, currentRecord) => [...new Set(visibleFields
  .filter(([field]) => serviceRecordFingerprint(openedRecord?.[field]) !== serviceRecordFingerprint(currentRecord?.[field]))
  .map(([, label]) => label))]
