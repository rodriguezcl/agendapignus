import { normalizeCustomerName } from "../../../domain/shared/normalization.mjs";
import { createCustomerId } from "../../../infrastructure/browser/identity.mjs";

export const blankCustomer = { customerId: '', kind: 'client', account: '', name: '', type: '', street: '', locality: '', province: '', phone: '', address: '', cctvService: false, fields: {} }

export const normalizeAccountKey = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '')

export const customerKind = customer => customer?.kind === 'subscriber' || String(customer?.account || '').toUpperCase().startsWith('PIG-') ? 'subscriber' : 'client'

export const customerKindLabel = customer => customerKind(customer) === 'subscriber' ? 'Abonado' : 'Cliente'

export const nextCustomerCode = (customers, kind) => {
  const prefix = kind === 'subscriber' ? 'PIG' : 'CLI'
  const highest = customers.reduce((max, customer) => {
    const match = String(customer.account || '').toUpperCase().match(new RegExp(`^${prefix}-(\\d+)$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`
}

export const createQuickClient = (task, customers = []) => {
  const name = normalizeCustomerName(task?.clientNameAtService || task?.client)
  const address = String(task?.address || '').trim()
  const phone = String(task?.phone || '').trim()
  if (!name || !address || !phone) return null
  const customer = { ...blankCustomer, customerId: createCustomerId(), kind: 'client', account: nextCustomerCode(customers, 'client'), name, type: 'Cliente de servicio', street: address, address, phone }
  return { customer, task: { ...task, newCustomer: false, customerId: customer.customerId, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name, address: customer.address, phone: customer.phone } }
}
