export function ticketCreateErrors({ draft, needsCustomer, duplicates = [], decision, checking, accountPending, duplicateError }) {
  const errors = {}
  if (!draft.categoryId) errors.categoryId = 'Seleccioná una categoría para el ticket.'
  if (needsCustomer && !draft.customerId) errors.customerId = 'Seleccioná una cuenta de los resultados. Escribir en el buscador no vincula un abonado o cliente.'
  if (draft.customerId && (checking || accountPending) && !duplicateError) errors.duplicates = 'Estamos consultando los tickets de la cuenta. Esperá a que termine la consulta y volvé a guardar.'
  if (draft.customerId && duplicateError) errors.duplicates = 'No pudimos revisar los tickets existentes. Usá «Reintentar consulta» antes de guardar.'
  if (duplicates.length && !decision && !errors.duplicates) errors.duplicates = 'Indicá si es el mismo caso o marcá «Es un caso diferente: crear un ticket nuevo».'
  if (!draft.description.trim()) errors.description = 'Completá las observaciones: qué ocurrió y qué gestión se necesita.'
  return errors
}
