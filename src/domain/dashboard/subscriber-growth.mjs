import { activeSubscribers } from '../customers/subscriber-policy.mjs'

export function activeSubscriberCount(customers = []) {
  return activeSubscribers(customers).length
}

export function subscriberGrowthPercentages({ baseCount, netGrowth, projectedNetGrowth } = {}) {
  const validBase = Number.isInteger(baseCount) && baseCount > 0
  const percent = value => validBase && Number.isFinite(value) ? value / baseCount * 100 : null
  return { baseCount: validBase ? baseCount : null, confirmedPercent: percent(netGrowth), projectedPercent: percent(projectedNetGrowth) }
}
