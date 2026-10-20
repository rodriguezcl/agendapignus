const fieldPermissions = {
  internalNote: 'planning.notes',
  internalChecklist: 'planning.checklist',
  paymentMethod: 'planning.commercial',
  amount: 'planning.commercial',
  monthlyFee: 'planning.commercial',
  form: 'planning.commercial',
  formEmail: 'planning.commercial',
  freezeMonthlyFee: 'planning.freeze',
  frozenMonths: 'planning.freeze',
  awaitingConfirmation: 'planning.confirm',
  servicePreparation: 'planning.ready',
  technicians: 'weekly.monthlyVehicles.assign',
  technicianIds: 'weekly.monthlyVehicles.assign'
}
const identityFields = new Set([
  'customerId', 'client', 'clientAccount', 'clientNameAtService', 'newCustomer',
  'subscriberReservation', 'address', 'phone', 'reservationCreatedAt',
  'reservationCreatedBy', 'reservationOriginal', 'reservationLinkedAt', 'reservationLinkedBy'
])
const reservationActions = new Set(['planning.reservation.create', 'planning.reservation.link', 'customers.create'])

export function canEditPlanningFields(can, existing) {
  return can(existing ? 'planning.edit' : 'planning.create')
}

export function canSavePlanningFields(can, existing) {
  return canEditPlanningFields(can, existing) || (existing && [
    'planning.notes', 'planning.checklist', 'planning.commercial', 'planning.freeze',
    'planning.linkAccount', 'planning.reservation.link', 'planning.confirm'
  ].some(can))
}

// A service editor also contains independently authorized actions. Keep their
// patches separate even when a general field handler produces a compound patch.
export function permittedPlanningPatch(patch, { can, existing, task = {}, action } = {}) {
  if (action && action !== 'planning.training' && !can(action)) return {}
  return Object.fromEntries(Object.entries(patch).filter(([key]) => {
    if (existing && ['time', 'scheduledTime'].includes(key)) return can('planning.edit') && can('planning.reschedule')
    if (identityFields.has(key)) {
      if (reservationActions.has(action)) return action !== 'customers.create' || can('planning.linkAccount')
      if (['address', 'phone'].includes(key) && (task.newCustomer || task.subscriberReservation)) return can(task.newCustomer ? 'customers.create' : 'planning.reservation.create')
      if (action === 'planning.training') return canEditPlanningFields(can, existing)
      return can(task.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')
    }
    const permission = fieldPermissions[key]
    return permission ? can(permission) : canEditPlanningFields(can, existing)
  }))
}

export function serviceCopyRecord(record, can) {
  const next = { ...record }
  if (!can('records.contact')) {
    delete next.address
    delete next.phone
  }
  if (!can('records.financial')) {
    for (const key of ['paymentMethod', 'amount', 'monthlyFee', 'freezeMonthlyFee', 'frozenMonths', 'form', 'formEmail']) delete next[key]
  }
  return next
}
