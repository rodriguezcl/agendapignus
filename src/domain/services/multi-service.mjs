export const selectedServiceIds = task => Array.isArray(task?.serviceTypes) && task.serviceTypes.length
  ? task.serviceTypes.map(item => String(item.id))
  : task?.serviceId != null && task.serviceId !== '' ? [String(task.serviceId)] : []

export const serviceTypesFor = task => task?.serviceTypes?.length ? task.serviceTypes : task?.service ? [{ id: task.serviceId, name: task.service }] : []
export const serviceTypesLabel = task => serviceTypesFor(task).map(item => item.name).join(' + ')

// Sum integer cents, so decimals never accumulate binary rounding errors.
export const serviceChargesTotal = rows => {
  const amounts = (rows || []).filter(row => String(row?.amount ?? '').trim() !== '')
  if (!amounts.length) return ''
  if (amounts.some(row => !/^\d+(\.\d{0,2})?$/.test(String(row.amount)))) return ''
  const total = amounts.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)
  return Number.isSafeInteger(total) && total >= 0 ? String(total / 100) : ''
}

export function serviceChargesComplete(task) {
  const types = serviceTypesFor(task), rows = task.serviceCharges
  return Array.isArray(rows) && rows.length === types.length && types.every(type => rows.filter(row => String(row?.id) === String(type.id)).length === 1) && rows.every(row => /^\d+(\.\d{1,2})?$/.test(String(row?.amount)) && Number.isSafeInteger(Math.round(Number(row.amount) * 100))) && serviceChargesTotal(rows) !== ''
}

export function serviceChargePatch(task, id, amount) {
  const serviceCharges = serviceTypesFor(task).map(type => ({ id: type.id, amount: String(type.id) === String(id) ? amount : task.serviceCharges?.find(row => String(row.id) === String(type.id))?.amount ?? '' }))
  return { serviceCharges, amount: serviceChargesTotal(serviceCharges) }
}

export function multiServicePatch(task, ids, catalog) {
  const selected = [...new Set(ids.map(String))].map(id => catalog.find(item => String(item.id) === id)).filter(Boolean)
  // Keep the alarm installation as the compatibility reference for PIG/form fields.
  selected.sort((a, b) => Number(b.code === 'alarm-installation' || b.name === 'Instalación de alarma') - Number(a.code === 'alarm-installation' || a.name === 'Instalación de alarma'))
  const previousTypes = serviceTypesFor(task)
  const previousCharges = task.serviceCharges || (previousTypes.length === 1 ? [{ id: previousTypes[0].id, amount: task.amount ?? '' }] : null)
  const serviceCharges = previousCharges ? selected.map(type => ({ id: type.id, amount: previousCharges.find(row => String(row.id) === String(type.id))?.amount ?? '' })) : undefined
  return {
    serviceCharges: selected.length > 1 ? serviceCharges : undefined,
    ...(serviceCharges ? { amount: serviceChargesTotal(serviceCharges) } : {}),
    serviceTypes: selected.map(({ id, name }) => ({ id, name })),
    serviceId: selected[0]?.id || '',
    service: selected[0]?.name || '',
    estimatedMinutes: task?.estimatedMinutes ?? 60,
    estimatedMinutesCustomized: true
  }
}
