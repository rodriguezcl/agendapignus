import { previousSubscriberAccount } from './customer-provenance.mjs'

const account = value => String(value || '').trim().toUpperCase()
// Ignore presentation differences only, not accents, word order or partial names.
const name = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-AR')

export function softguardVerificationCases(customers = []) {
  const subscribers = new Map()
  for (const customer of customers) {
    const key = account(customer.account)
    if (/^PIG-\d+$/.test(key) && name(customer.name)) subscribers.set(key, customer)
  }
  const cases = new Map()
  for (const client of customers) {
    const previous = previousSubscriberAccount(client)
    const subscriber = subscribers.get(previous)
    if (!/^CLI-\d+$/.test(account(client.account)) || !subscriber || name(client.name) !== name(subscriber.name)) continue
    if (!cases.has(previous)) cases.set(previous, { account: previous, name: subscriber.name, clients: [] })
    const entry = cases.get(previous)
    if (!entry.clients.some(item => account(item.account) === account(client.account))) entry.clients.push(client)
  }
  return [...cases.values()].sort((a, b) => a.account.localeCompare(b.account))
}
