export const holidayForDate = (records, date) => (records || []).find(record => record.date === date) || null

export const holidayDecisionForDate = (weekly, date) => weekly?._holidayOverrides?.[date] || null

export const holidayIsBlocked = (holiday, decision) => Boolean(holiday) && decision?.status !== 'working'

export const holidayDecisionLabel = decision => decision?.status === 'working'
  ? 'Día laboral habilitado'
  : decision?.status === 'closed'
    ? 'Día no operativo'
    : 'Definición pendiente'
