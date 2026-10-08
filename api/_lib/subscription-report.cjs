const subscriptionHeaders = ['Monto de abono mensual', 'Meses congelados', 'Cantidad de meses']
function subscriptionColumns(record, roleCode) {
  if (roleCode === 'technician') return ['', '', '']
  const amount = String(record.monthlyFee ?? '').trim()
  const decision = record.freezeMonthlyFee === true ? 'Sí' : record.freezeMonthlyFee === false ? 'No' : 'Sin registrar'
  return [amount, decision, record.freezeMonthlyFee === true ? String(record.frozenMonths || '') : '']
}
module.exports = { subscriptionHeaders, subscriptionColumns }
