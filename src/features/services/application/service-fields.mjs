import { createTaskId } from "../../../infrastructure/browser/identity.mjs";
import { normalizeServiceName } from "../../../domain/shared/normalization.mjs";
import { serviceCode, isTrainingService } from "../../../domain/services/service.mjs";
import { serviceTypesFor } from "../../../domain/services/multi-service.mjs";
import { isEquipmentRetirementName } from "../../../domain/services/equipment-retirement.mjs";
import { normalizeServiceEstimatedMinutes } from "../../../domain/agenda/service-scheduling.mjs";

export const INSTALLATION_ZONES = [
  ['docta', 'Docta Urbanización'],
  ['nobu-town', 'Nobu Town'],
  ['residencial', 'Residencial con monitoreo'],
  ['no-monitoreada', 'Residencial sin monitoreo']
]

export const createInternalChecklistItem = () => ({ id: createTaskId(), text: '', completed: false })

export const normalizeInternalChecklist = value => Array.isArray(value) ? value.map((item, index) => ({
  id: String(item?.id || `checklist-${index}`),
  text: String(item?.text || ''),
  completed: Boolean(item?.completed)
})) : []

export const resolveServiceForTask = (task, services = []) => services.find(service => String(service.id) === String(task?.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task?.service))

export const serviceEstimateForTask = (task, service) => task?.estimatedMinutesCustomized === false
  ? normalizeServiceEstimatedMinutes(service?.estimatedMinutes)
  : normalizeServiceEstimatedMinutes(task?.estimatedMinutes, normalizeServiceEstimatedMinutes(service?.estimatedMinutes))

export const taskWithServiceEstimate = (task, service) => ({ ...task, estimatedMinutes: serviceEstimateForTask(task, service) })

export const PAYMENT_SERVICE_NAMES = new Set([
  'instalacion de camara',
  'instalacion de camaras',
  'instalacion de cerco electrico',
  'service de alarma',
  'service de camara',
  'service de camaras',
  'service de cerco electrico',
  'otro service'
])

export const FORM_OPTIONS = ['Completo', 'Incompleto (Abonado completa a mano)']

export const PAYMENT_OPTIONS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'A confirmar', 'No aplica']

export const technicianVisibleServiceExtras = task => {
  const paymentMethod = String(task?.paymentMethod || '').trim()
  const form = String(task?.form || '').trim()
  const cashPayment = normalizeServiceName(paymentMethod) === 'efectivo'
  const handwrittenForm = normalizeServiceName(form).startsWith('incompleto')
  return {
    paymentMethod: cashPayment ? 'Efectivo' : '',
    amount: cashPayment ? String(task?.amount || '').trim() : '',
    form: handwrittenForm ? form : ''
  }
}

export const normalizeCurrencyAmount = value => {
  const input = String(value ?? '').trim().replace(/[^\d.,]/g, '')
  if (!input) return ''
  const normalized = input.includes(',') ? input.replace(/\./g, '').replace(',', '.') : input
  const [integerPart = '', ...decimalParts] = normalized.split('.')
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0'
  const decimals = decimalParts.join('').slice(0, 2)
  return decimalParts.length ? `${integer}.${decimals}` : integer
}

export const formatCurrencyAmount = value => {
  const normalized = normalizeCurrencyAmount(value)
  if (!normalized) return ''
  const amount = Number(normalized)
  if (!Number.isFinite(amount)) return ''
  const hasDecimals = normalized.includes('.') && Number(normalized.split('.')[1] || 0) !== 0
  return `$ ${amount.toLocaleString('es-AR', { minimumFractionDigits: hasDecimals ? 2 : 0, maximumFractionDigits: 2 })}`
}

export const normalizeFormValue = value => {
  const normalized = normalizeServiceName(value)
  if (normalized === 'completo' || normalized === 'completado') return FORM_OPTIONS[0]
  if (normalized.startsWith('incompleto')) return FORM_OPTIONS[1]
  return ''
}

export const serviceExtraAvailability = (service, installationZone = '') => {
  const alarmInstallation = serviceCode(service) === 'alarm-installation'
  const residentialAlarm = alarmInstallation && installationZone === 'residencial'
  const ownershipChange = normalizeServiceName(service?.name).includes('titularidad')
  return {
    paymentMethod: residentialAlarm || PAYMENT_SERVICE_NAMES.has(normalizeServiceName(service?.name)),
    monthlyFee: residentialAlarm,
    freezeMonthlyFee: residentialAlarm,
    form: alarmInstallation || ownershipChange
  }
}

export const applicableServiceExtras = (task, service) => {
  const available = serviceTypesFor(task).length > 1 ? serviceTypesFor(task).reduce((all, type) => { const flags = serviceExtraAvailability(type, task?.installationZone); return Object.fromEntries(Object.keys(flags).map(key => [key, all[key] || flags[key]])) }, {}) : serviceExtraAvailability(service, task?.installationZone)
  const paymentMethod = available.paymentMethod ? task?.paymentMethod || '' : ''
  return {
    paymentMethod,
    amount: paymentMethod && paymentMethod !== 'No aplica' ? task?.amount || '' : '',
    monthlyFee: available.monthlyFee ? task?.monthlyFee || '' : '',
    freezeMonthlyFee: available.freezeMonthlyFee ? task?.freezeMonthlyFee ?? null : false,
    frozenMonths: available.freezeMonthlyFee && task?.freezeMonthlyFee ? Number(task.frozenMonths || 0) : 0,
    form: available.form ? normalizeFormValue(task?.form) : '',
    formEmail: available.form && normalizeFormValue(task?.form) === FORM_OPTIONS[0] ? String(task?.formEmail || '').trim() : ''
  }
}

export const invalidFormEmail = (task, service) => {
  const email = applicableServiceExtras(task, service).formEmail
  return Boolean(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
}

export const requiresPaymentAmount = (task, service) => {
  const paymentMethod = serviceExtraAvailability(service, task?.installationZone).paymentMethod ? String(task?.paymentMethod || '').trim() : ''
  return Boolean(paymentMethod && !['A confirmar', 'No aplica'].includes(paymentMethod) && !String(task?.amount || '').trim())
}

export const weeklyTaskMissingFields = (task, service) => {
  if (task?.vehicleControl) {
    return [['hora', task?.time], ['tipo de servicio', task?.serviceId || task?.service], ['vehículo', task?.vehicleId], ['técnico responsable', task?.technicianIds?.[0]]]
      .filter(([, value]) => !String(value || '').trim())
      .map(([label]) => label)
  }
  const missing = [['hora', task?.time], ['tipo de servicio', task?.service], ['cliente', task?.customerId || ((task?.newCustomer || task?.subscriberReservation || isTrainingService(service)) && task?.client)], ['dirección', task?.address], ['contacto', isTrainingService(service) || task?.phone], ['detalle', task?.detail]]
    .filter(([, value]) => !String(value || '').trim())
    .map(([label]) => label)
  if (serviceCode(service) === 'alarm-installation' && !task?.installationZone) missing.push('ubicación de la instalación')
  if (task?.subscriberReservation && serviceCode(service) !== 'alarm-installation') missing.push('una cuenta CLI o PIG registrada (Reserva PIG sólo está disponible para Instalación de alarma)')
  if (task?.installationZone === 'residencial' && (serviceCode(service) === 'alarm-installation' || serviceTypesFor(task).some(type => serviceCode(type) === 'alarm-installation'))) {
    if (!(Number(normalizeCurrencyAmount(task.monthlyFee)) > 0)) missing.push('abono mensual mayor a cero')
    if (typeof task.freezeMonthlyFee !== 'boolean') missing.push('meses congelados (Sí o No)')
    if (task.freezeMonthlyFee === true && !(Number.isInteger(Number(task.frozenMonths)) && Number(task.frozenMonths) > 0)) missing.push('cantidad de meses congelados')
  }
  if (requiresPaymentAmount(task, service)) missing.push('monto')
  if (invalidFormEmail(task, service)) missing.push('email del formulario válido')
  return missing
}

export const serviceColorClass = service => {
  const normalized = String(service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (isEquipmentRetirementName(normalized)) return 'service-retirement'
  if (normalized.includes('titularidad')) return 'service-ownership'
  if (normalized.includes('camara')) return 'service-cameras'
  if (normalized.includes('cerco')) return 'service-fence'
  if (normalized.includes('alarma')) return 'service-alarm'
  if (normalized.includes('relevamiento')) return 'service-survey'
  if (normalized.includes('ampliacion') || normalized.includes('mejora')) return 'service-upgrade'
  return 'service-other'
}
