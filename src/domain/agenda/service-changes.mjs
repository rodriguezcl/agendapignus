// Compare editable values only; persistence/audit metadata does not make a draft dirty.
export const serviceEditableFields = ['time', 'serviceId', 'service', 'customerId', 'client', 'address', 'phone', 'detail', 'internalNote', 'paymentMethod', 'amount', 'monthlyFee', 'form', 'formEmail', 'installationZone', 'estimatedMinutes', 'servicePhotoUrl', 'servicePhotoAttachedAt']

export function serviceHasChanges(task, saved) {
  if (!saved) return true
  if (serviceEditableFields.some(key => String(task?.[key] ?? '') !== String(saved?.[key] ?? ''))) return true
  if (Boolean(task?.servicePhotoAttached) !== Boolean(saved?.servicePhotoAttached)) return true
  const checklist = value => (value || []).map(item => ({ text: String(item?.text || ''), completed: Boolean(item?.completed) }))
  return JSON.stringify(checklist(task?.internalChecklist)) !== JSON.stringify(checklist(saved?.internalChecklist))
}

export function restoreSavedService(task, saved) {
  const restored = { ...task }
  for (const key of serviceEditableFields) restored[key] = saved[key] ?? ''
  return {
    ...restored,
    historyId: saved.id,
    time: saved.time || saved.scheduledTime || '',
    clientAccount: saved.clientAccount || saved.account || '',
    clientNameAtService: saved.clientNameAtService || '',
    estimatedMinutesCustomized: saved.estimatedMinutesCustomized,
    internalChecklist: (saved.internalChecklist || []).map(item => ({ ...item })),
    servicePhotoAttached: Boolean(saved.servicePhotoAttached),
    newCustomer: false,
    subscriberReservation: false
  }
}
