export const normalizeServiceName = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()

// Operational searches intentionally ignore accents, casing, spaces and signs.
export const normalizeSearchText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es')
  .replace(/[^a-z0-9]/g, '')

export const normalizeCustomerName = value => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleUpperCase('es-AR')
