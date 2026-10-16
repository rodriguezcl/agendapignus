// Accept either decimal key while editing, and the displayed Argentine format
// when pasted. Never silently truncate cents or reinterpret invalid amounts.
export function parseCollectionAmount(value) {
  const text = String(value ?? '').trim()
  let normalized
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) {
    normalized = text.replace(/\./g, '').replace(',', '.')
  } else if (/^(?:\d+(?:[.,]\d{0,2})?|[.,]\d{1,2})$/.test(text)) {
    normalized = text.replace(',', '.')
  } else return null
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount > 0 && amount <= 999999999.99 ? String(amount) : null
}

export function displayCollectionAmount(value) {
  const amount = parseCollectionAmount(value)
  return amount === null ? String(value ?? '') : new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount))
}
