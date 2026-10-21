import { activeSubscribers, subscriberZone } from '../customers/subscriber-policy.mjs'

export function subscriberDistribution(customers = []) {
  const active = activeSubscribers(customers)
  const counts = { docta: 0, 'nobu-town': 0, residencial: 0 }
  for (const customer of active) counts[subscriberZone(customer)]++
  return { total: active.length, items: [
    ['docta', 'Docta', 'var(--ap-accent)'],
    ['nobu-town', 'Nobu Town', 'var(--ap-info)'],
    ['residencial', 'Residenciales / otras zonas', 'var(--ap-success)']
  ].map(([key, label, color]) => ({ key, label, color, count: counts[key], percentage: active.length ? counts[key] / active.length * 100 : 0 })) }
}
