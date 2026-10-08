const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
export const subscriptionFields = ['monthlyFee', 'monthlyFeeEffectiveFrom', 'freezeMonthlyFee', 'frozenMonths']

export function recordBelongsToCustomer(record, customer) {
  if (record.customerId) return String(record.customerId) === String(customer.customerId)
  const account = record.clientAccount || record.account || String(record.client || '').match(/^(?:PIG|CLI)-\d+\b/i)?.[0]
  return Boolean(account && normalize(account) === normalize(customer.account))
}

export function isResidentialInstallation(record, services = []) {
  if (record.status !== 'Completado' || record.subscriberReservation || record.vehicleControl) return false
  const zone = record.installationZone || (/docta|nobu/i.test(`${record.address || ''} ${record.client || ''}`) ? 'excluded' : 'residencial')
  if (zone !== 'residencial') return false
  const types = record.serviceTypes?.length ? record.serviceTypes : [{ id: record.serviceId, name: record.service }]
  return types.some(type => {
    const catalog = services.find(service => type.id != null && String(service.id) === String(type.id))
    const code = catalog?.code || type.code
    return code ? code === 'alarm-installation' : normalize(type.name) === 'instalacion de alarma'
  })
}

export function subscriptionCorrectionBase(record) {
  // Include eligibility and identity as well as amounts: a concurrent reassignment
  // must not cause a correction to be written to a different customer.
  return Object.fromEntries(['id', 'customerId', 'clientAccount', 'account', 'client', 'status', 'subscriberReservation', 'vehicleControl', 'installationZone', 'address', 'date', 'serviceId', 'service', 'serviceTypes', ...subscriptionFields, 'subscriptionCorrectedAt', 'subscriptionCorrectedBy'].map(key => [key, record[key] ?? null]))
}

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }) }

export function correctSubscription(state, input, user, now = new Date().toISOString()) {
  const customer = state.customers?.find(item => String(item.customerId) === String(input.customerId))
  const before = state.history?.find(item => String(item.id) === String(input.recordId))
  if (!customer || !before) fail('El cliente o la instalación ya no existe.', 404)
  if (!recordBelongsToCustomer(before, customer) || !isResidentialInstallation(before, state.services)) fail('Sólo se pueden corregir instalaciones de alarma residenciales completadas de este cliente.')
  if (JSON.stringify(subscriptionCorrectionBase(before)) !== JSON.stringify(input.base)) fail('Los datos de la instalación cambiaron en otra sesión. Cerrá la ficha, actualizá y volvé a revisar.', 409)
  const values = input.values
  if (!values || Object.keys(values).some(key => !subscriptionFields.includes(key))) fail('Los campos de la corrección no son válidos.')
  const amount = String(values.monthlyFee ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) > 999999999.99) fail('Ingresá un monto válido, sin separadores de miles y con hasta dos decimales.')
  const date = String(values.monthlyFeeEffectiveFrom || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) fail('Ingresá una fecha de vigencia válida.')
  if (typeof values.freezeMonthlyFee !== 'boolean') fail('Indicá Sí o No en meses congelados.')
  const months = values.freezeMonthlyFee ? Number(values.frozenMonths) : 0
  const options = state.agenda?.weekly?._frozenMonthOptions ?? [4, 6]
  const preserved = before.freezeMonthlyFee === true && Number(before.frozenMonths) === months
  if (values.freezeMonthlyFee && (!Number.isInteger(months) || months < 1 || months > 120 || (!options.includes(months) && !preserved))) fail('Seleccioná una cantidad vigente de meses congelados.')
  const patch = { monthlyFee: String(Number(amount)), monthlyFeeEffectiveFrom: date, freezeMonthlyFee: values.freezeMonthlyFee, frozenMonths: months, subscriptionCorrectedAt: now, subscriptionCorrectedBy: { id: user.id, name: user.name } }
  const after = { ...before, ...patch }
  // Synchronize only the four commercial fields and trace, never scheduling or status.
  const sync = value => {
    if (Array.isArray(value)) return value.map(sync)
    if (!value || typeof value !== 'object') return value
    const matched = (value.historyId && String(value.historyId) === String(before.id)) || (before.sourceTaskId && value.taskId && String(value.taskId) === String(before.sourceTaskId))
    return Object.fromEntries(Object.entries(matched ? { ...value, ...patch } : value).map(([key, item]) => [key, sync(item)]))
  }
  return { before, after, state: { ...state, history: state.history.map(record => String(record.id) === String(before.id) ? after : record), agenda: sync(state.agenda) } }
}
