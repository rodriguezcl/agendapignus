export const selectedServiceIds = task => Array.isArray(task?.serviceTypes) && task.serviceTypes.length
  ? task.serviceTypes.map(item => String(item.id))
  : task?.serviceId != null && task.serviceId !== '' ? [String(task.serviceId)] : []

export const serviceTypesFor = task => task?.serviceTypes?.length ? task.serviceTypes : task?.service ? [{ id: task.serviceId, name: task.service }] : []
export const serviceTypesLabel = task => serviceTypesFor(task).map(item => item.name).join(' + ')

export function multiServicePatch(task, ids, catalog) {
  const selected = [...new Set(ids.map(String))].map(id => catalog.find(item => String(item.id) === id)).filter(Boolean)
  // Keep the alarm installation as the compatibility reference for PIG/form fields.
  selected.sort((a, b) => Number(b.code === 'alarm-installation' || b.name === 'Instalación de alarma') - Number(a.code === 'alarm-installation' || a.name === 'Instalación de alarma'))
  return {
    serviceTypes: selected.map(({ id, name }) => ({ id, name })),
    serviceId: selected[0]?.id || '',
    service: selected[0]?.name || '',
    estimatedMinutes: task?.estimatedMinutes ?? 60,
    estimatedMinutesCustomized: true
  }
}
