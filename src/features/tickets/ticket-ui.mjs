import resolution from '../../../api/_lib/ticket-resolution.cjs'

export const TICKET_RESOLUTION_METHODS = resolution.RESOLUTION_METHODS
export const TICKET_STATES = ['Nuevo', 'En gestión', 'En espera', 'Resuelto', 'Fusionado']
export const TICKET_PRIORITIES = ['Crítica', 'Alta', 'Media', 'Baja']
export const TICKET_ORIGINS = { phone: 'Llamada', internal: 'Solicitud interna', technical: 'Informe técnico', technician: 'Informe técnico', email: 'Correo', followup: 'Seguimiento técnico' }
export const ticketNumber = ticket => ticket?.displayNumber || `Ticket#${ticket?.number || ''}`
export const ticketDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
export const ticketCustomer = ticket => ticket?.customerName || ticket?.customerSnapshot?.name || ticket?.customer?.name || ticket?.requesterName || 'Solicitud interna'
export const ticketAccount = customer => customer?.account || customer?.code || customer?.customerAccount || ''
export const newCommandId = () => globalThis.crypto?.randomUUID?.() || `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}`
export function ticketRule(config, categoryId, subcategoryId) {
  const category = (config?.categories || []).find(item => item.id === categoryId)
  const subcategory = category?.subcategories?.find(item => item.id === subcategoryId)
  return { priority: 'Media', customerPolicy: 'optional', showEvent: false, showZone: false, ...category, ...Object.fromEntries(Object.entries(subcategory || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')) }
}
export function validateTicketFiles(files) {
  if (files.length > 5) throw new Error('Podés adjuntar hasta 5 archivos por mensaje.')
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  if (files.some(file => !allowed.has(file.type))) throw new Error('Los adjuntos deben ser PDF, JPG, PNG o WEBP.')
  if (files.some(file => file.size > 2 * 1024 * 1024)) throw new Error('Cada archivo puede pesar hasta 2 MB.')
  if (files.reduce((total, file) => total + file.size, 0) > 2.5 * 1024 * 1024) throw new Error('Los archivos de un mensaje pueden sumar hasta 2,5 MB.')
  return files
}
export async function encodeTicketFiles(files) {
  validateTicketFiles(files)
  return Promise.all(files.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ fileName: file.name, mimeType: file.type, data: String(reader.result).split(',')[1] })
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}. Volvé a seleccionarlo.`))
    reader.readAsDataURL(file)
  })))
}
