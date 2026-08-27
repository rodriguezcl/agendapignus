const MONTH_LABELS = Object.freeze(['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'])

export function visibleAnnualMonthLabels(year, referenceDate = new Date()) {
  const selectedYear = Number(year)
  if (!Number.isInteger(selectedYear)) return []
  const currentYear = referenceDate.getFullYear()
  const visibleMonths = selectedYear < currentYear
    ? MONTH_LABELS.length
    : selectedYear === currentYear
      ? referenceDate.getMonth() + 1
      : 0
  return MONTH_LABELS.slice(0, visibleMonths)
}
