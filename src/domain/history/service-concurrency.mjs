const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

export const serviceRecordFingerprint = record => JSON.stringify(canonical(record || null))

export const serviceRecordChanged = (openedRecord, currentRecord) => serviceRecordFingerprint(openedRecord) !== serviceRecordFingerprint(currentRecord)
