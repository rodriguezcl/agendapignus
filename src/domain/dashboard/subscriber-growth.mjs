import { isActiveSubscriber } from '../customers/subscriber-policy.mjs'

/** Percentages require an explicit, positive subscriber base. Unknown is not zero. */
export function activeSubscriberCount(customers = []) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const accounts = new Set(), ids = new Set()
  let count = 0
  for (const customer of customers) {
    const account = normalize(customer.account).replace(/\s/g, '')
    const id = String(customer.customerId || '')
    if (!isActiveSubscriber(customer)) continue
    if ((!account && !id) || (account && accounts.has(account)) || (id && ids.has(id))) continue
    if (account) accounts.add(account)
    if (id) ids.add(id)
    count++
  }
  return count
}

export function subscriberGrowthPercentages({ baseCount, netGrowth, projectedNetGrowth } = {}) {
  const validBase = Number.isInteger(baseCount) && baseCount > 0
  const percent = value => validBase && Number.isFinite(value) ? value / baseCount * 100 : null
  return { baseCount: validBase ? baseCount : null, confirmedPercent: percent(netGrowth), projectedPercent: percent(projectedNetGrowth) }
}
