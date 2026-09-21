const ADVANCE = 'Avance registrado'
const isIntermediate = record => Boolean(record?.serviceJourney && record.serviceJourney.index < record.serviceJourney.total)
const completedVisit = record => [ADVANCE, 'Completado'].includes(record?.status)

function assertJourneyReport(record, type, history = []) {
  if (type === ADVANCE && !isIntermediate(record)) throw new Error('Registrar avance corresponde únicamente a una jornada intermedia.')
  if (type === 'Completado' && isIntermediate(record)) throw new Error('Esta es una jornada intermedia. Registrá el avance; el servicio se completa en la última jornada.')
  if (record?.serviceJourney && [ADVANCE, 'Completado'].includes(type)) {
    const earlier = history.filter(item => item.serviceJourney?.id === record.serviceJourney.id && item.serviceJourney.index < record.serviceJourney.index)
    if (earlier.some(item => !completedVisit(item) && item.status !== 'Cancelado')) throw new Error('Hay jornadas anteriores sin informar. Administración debe revisarlas antes de cerrar esta jornada.')
  }
}

function validateServiceJourneys(state, previous = null) {
  const history = state?.history || [], old = new Map((previous?.history || []).map(record => [String(record.id), record]))
  const groups = new Map()
  for (const record of history) {
    const journey = record.serviceJourney, prior = old.get(String(record.id))
    if (prior?.serviceJourney && ['id', 'index', 'total'].some(key => prior.serviceJourney[key] !== journey?.[key])) throw new Error('La identidad de las jornadas no puede modificarse desde una edición individual.')
    if (!journey) {
      if (record.status === ADVANCE) throw new Error('Un servicio de una jornada no admite registrar avance.')
      continue
    }
    if (!journey.id || typeof journey.id !== 'string' || !Number.isInteger(journey.index) || !Number.isInteger(journey.total) || journey.total < 2 || journey.total > 20 || journey.index < 1 || journey.index > journey.total) throw new Error('La identificación de las jornadas no es válida.')
    if (record.vehicleControl || String(record.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === 'reunion mensual') throw new Error('Este tipo de servicio no admite varias jornadas.')
    const group = groups.get(journey.id) || []
    group.push(record); groups.set(journey.id, group)
    if (!prior?.serviceJourney && prior && (prior.startedAt || prior.technicalStatus || prior.status !== 'Pendiente')) throw new Error('No se puede convertir un servicio que ya tiene gestión en varias jornadas.')
    if (!prior?.serviceJourney || record.date !== prior.date || record.time !== prior.time || record.estimatedMinutes !== prior.estimatedMinutes) {
      const date = new Date(`${record.date}T12:00:00Z`)
      const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(record.time || '')
      const weekday = date.getUTCDay(), end = weekday === 5 ? 1200 : weekday === 6 ? 720 : 1020
      const start = time ? Number(time[1]) * 60 + Number(time[2]) : NaN
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== record.date || !weekday || !Number.isFinite(start) || start < 480 || start + Number(record.estimatedMinutes) > end) throw new Error('La jornada está fuera de los días u horarios habilitados.')
      if (state.agenda?.weekly?._holidayOverrides?.[record.date]?.status === 'closed') throw new Error('No se puede reservar una jornada en un feriado cerrado.')
    }
    assertJourneyReport(record, record.status, history)
  }
  for (const [id, group] of groups) {
    group.sort((a, b) => a.serviceJourney.index - b.serviceJourney.index)
    if (group.length !== group[0].serviceJourney.total || group.some((record, index) => record.serviceJourney.index !== index + 1 || record.serviceJourney.total !== group.length)) throw new Error('Deben guardarse todas las jornadas del servicio juntas.')
    if (String(group[0].id) !== id) throw new Error('La primera jornada debe identificar el servicio original.')
    group.forEach((record, index) => {
      if (record.customerId !== group[0].customerId || String(record.serviceId) !== String(group[0].serviceId)) throw new Error('Las jornadas deben pertenecer al mismo cliente y tipo de servicio.')
      if (index && record.date <= group[index - 1].date) throw new Error('Cada jornada debe tener una fecha posterior a la anterior.')
    })
  }
  for (const record of previous?.history || []) if (record.serviceJourney && !history.some(item => String(item.id) === String(record.id))) throw new Error('No se puede eliminar una jornada vinculada. Cancelala para conservar el historial del servicio.')
}

module.exports = { ADVANCE, isIntermediate, assertJourneyReport, validateServiceJourneys }
