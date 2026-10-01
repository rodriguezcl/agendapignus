// The employee draft is independent of agenda projections and other records.
// Keep the baseline captured when editing; never overwrite a newer employee.
export function employeeOperations(before, after) {
  const id = after?.id ?? before?.id
  if (id == null) throw new Error('Falta el identificador del empleado.')
  if (before && after && String(before.id) !== String(after.id)) throw new Error('No se puede cambiar el identificador del empleado.')
  return [{ path: ['employees', { key: 'id', id: String(id) }], before: before || null, after: after || null, existed: Boolean(before), exists: Boolean(after) }]
}
