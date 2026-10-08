// A service date is not a contractual effective date. Never infer validity.
export function customerMonthlyFee(customer, history = []) {
  const account = String(customer?.account || '').trim().toUpperCase()
  const records = history.filter(record => {
    if (record.subscriberReservation || record.status !== 'Completado' || String(record.monthlyFee ?? '').trim() === '') return false
    if (record.customerId && customer?.customerId) return String(record.customerId) === String(customer.customerId)
    const recordedAccount = String(record.clientAccount || record.account || String(record.client || '').match(/^(?:PIG|CLI)-\d+\b/i)?.[0] || '').toUpperCase()
    return Boolean(account && recordedAccount === account)
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
  const latest = records[0]
  return latest ? { amount: latest.monthlyFee, effectiveFrom: latest.monthlyFeeEffectiveFrom || '', serviceDate: latest.date || '' } : null
}
