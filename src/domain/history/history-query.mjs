import { normalizeSearchText } from '../shared/normalization.mjs'
import { serviceTypesFor, serviceTypesLabel } from '../services/multi-service.mjs'
import { historyStatusLabel } from '../dashboard/dashboard-metrics.mjs'
import { sortOperationalHistory } from './history-order.mjs'

// Reuse normalized fields while a history revision remains unchanged.
export const createHistorySearchIndex = (history = []) => history.map(record => ({
  record,
  text: normalizeSearchText(`${record.client} ${serviceTypesLabel(record)} ${record.technicians?.join(' ')}`),
  services: serviceTypesFor(record).map(type => normalizeSearchText(type.name)),
  status: historyStatusLabel(record)
}))

export function filterHistoryRecords(index, {
  search = '', fromDate = '', toDate = '', serviceFilter = '', statusFilter = 'all',
  compare = sortOperationalHistory
} = {}) {
  const query = normalizeSearchText(search)
  const selectedService = normalizeSearchText(serviceFilter)
  return index.filter(entry =>
    entry.text.includes(query) &&
    (!fromDate || entry.record.date >= fromDate) &&
    (!toDate || entry.record.date <= toDate) &&
    (!selectedService || entry.services.includes(selectedService)) &&
    (statusFilter === 'all' || entry.status === statusFilter)
  ).map(entry => entry.record).sort(compare)
}
