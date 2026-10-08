const defaults = [4, 6]
function validateFrozenMonths(state, previous) {
  const options = state.agenda?.weekly?._frozenMonthOptions ?? defaults
  if (!Array.isArray(options) || options.some(n => !Number.isInteger(n) || n < 1 || n > 120) || new Set(options).size !== options.length) throw new Error('Los meses congelados disponibles deben ser enteros únicos entre 1 y 120.')
  const old = new Map((previous?.history || []).map(record => [String(record.id), record]))
  for (const record of state.history || []) {
    if (!record.freezeMonthlyFee) continue
    const months = Number(record.frozenMonths)
    const before = old.get(String(record.id))
    const preserved = before?.freezeMonthlyFee && Number(before.frozenMonths) === months
    if (!Number.isInteger(months) || months < 1 || months > 120 || (!preserved && !options.includes(months))) throw new Error('Seleccioná una cantidad vigente de meses congelados.')
  }
}
module.exports = { validateFrozenMonths }
