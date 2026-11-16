export const holidayForDate = (records, date, weekly = {}) => (records || []).find(record => record.date === date) || (weekly._holidayOverrides?.[date]?.transferredFrom ? { date, name: weekly._holidayOverrides[date].holidayName } : null)

export const holidayDecisionForDate = (weekly, date) => weekly?._holidayOverrides?.[date] || null

export const holidayIsBlocked = (holiday, decision) => decision?.status === 'closed' || Boolean(holiday) && decision?.status !== 'working'

export const holidayDecisionLabel = decision => decision?.status === 'working'
  ? 'Día laboral habilitado'
  : decision?.status === 'closed'
    ? 'Día no operativo'
    : 'Definición pendiente'

export function transferHoliday(state, { from, to, holiday, user, today, now = new Date().toISOString() }) {
  const valid = day => /^\d{4}-\d{2}-\d{2}$/.test(day || '') && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day
  if (!valid(from) || !valid(to) || from === to || from < today || to < today) throw new Error('Elegí una fecha distinta, desde hoy en adelante.')
  if (!holiday || holiday.date !== from) throw new Error('No se encontró el feriado de origen.')
  const weekly = state.agenda?.weekly || {}, overrides = weekly._holidayOverrides || {}
  if (overrides[from]?.transferredTo) throw new Error('Este feriado ya fue trasladado. Abrí su nueva fecha.')
  if (overrides[to]?.transferredFrom || overrides[to]?.transferredTo) throw new Error('La fecha de destino ya participa en otro traslado.')
  const metadata = { holidayName: holiday.name, decidedAt: now, decidedById: user.id, decidedByName: user.name }
  return { ...state, agenda: { ...state.agenda, weekly: { ...weekly, _holidayOverrides: { ...overrides,
    [from]: { ...metadata, status: 'working', transferredTo: to },
    [to]: { ...metadata, status: 'closed', transferredFrom: from }
  } } } }
}
