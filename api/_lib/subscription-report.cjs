const subscriptionHeaders = ['Monto de abono mensual', 'Meses congelados', 'Cantidad de meses']
function formatReportCurrency(value) {
  const raw = String(value ?? '').trim().replace(/^\$\s*/, '')
  if (!raw) return ''
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return ''
  const amount = Number(normalized)
  if (!Number.isFinite(amount)) return ''
  const hasCents = Number(normalized.split('.')[1] || 0) !== 0
  return `$ ${amount.toLocaleString('es-AR', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`
}
function subscriptionColumns(record, roleCode) {
  if (roleCode === 'technician') return ['', '', '']
  const amount = formatReportCurrency(record.monthlyFee)
  const decision = record.freezeMonthlyFee === true ? 'Sí' : record.freezeMonthlyFee === false ? 'No' : 'Sin registrar'
  return [amount, decision, record.freezeMonthlyFee === true ? String(record.frozenMonths || '') : '']
}
module.exports = { subscriptionHeaders, subscriptionColumns, formatReportCurrency }
