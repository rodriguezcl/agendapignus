const defaults = [4, 6]
function validateFrozenMonths(state, previous) {
  const options = state.agenda?.weekly?._frozenMonthOptions ?? defaults
  if (!Array.isArray(options) || options.some(n => !Number.isInteger(n) || n < 1 || n > 120) || new Set(options).size !== options.length) throw new Error('Los meses congelados disponibles deben ser enteros únicos entre 1 y 120.')
  const old = new Map((previous?.history || []).map(record => [String(record.id), record]))
  for (const record of state.history || []) {
    const prior = old.get(String(record.id))
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const types = [...(record.serviceTypes || []), { id: record.serviceId, name: record.service }]
    const residential = record.installationZone === 'residencial' && types.some(type => {
      const service = (state.services || []).find(item => String(item.id) === String(type.id || type.serviceId))
      return type.code === 'alarm-installation' || service?.code === 'alarm-installation' || normalize(type.name || service?.name) === 'instalacion de alarma'
    })
    const fields = ['monthlyFee', 'freezeMonthlyFee', 'frozenMonths', 'installationZone', 'serviceId', 'service', 'serviceTypes']
    const changed = !prior || fields.some(key => JSON.stringify(record[key]) !== JSON.stringify(prior[key]))
    if (residential && changed) {
      const raw = String(record.monthlyFee ?? '').trim()
      const amount = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || !(Number(amount) > 0)) throw new Error('Ingresá un abono mensual válido mayor a cero para la instalación residencial con monitoreo.')
      if (typeof record.freezeMonthlyFee !== 'boolean') throw new Error('Indicá Sí o No en meses congelados.')
    }
    if (!record.freezeMonthlyFee) continue
    const months = Number(record.frozenMonths)
    const before = old.get(String(record.id))
    const preserved = before?.freezeMonthlyFee && Number(before.frozenMonths) === months
    if (!Number.isInteger(months) || months < 1 || months > 120 || (!preserved && !options.includes(months))) throw new Error('Seleccioná una cantidad vigente de meses congelados.')
  }
}
module.exports = { validateFrozenMonths }
