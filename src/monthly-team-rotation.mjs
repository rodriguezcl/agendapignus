const DEFAULT_TECHNICIAN_ORDER = [
  ['rodrigo', 'gonzalez'],
  ['pascual', 'gonzalez'],
  ['mariano', 'diaz', 'tillard'],
  ['santos', 'diaz'],
  ['leonardo', 'rivadero']
]

const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export const orderedMonthlyTechnicians = technicians => {
  const remaining = [...(technicians || [])]
  const preferred = DEFAULT_TECHNICIAN_ORDER.map(tokens => {
    const index = remaining.findIndex(technician => tokens.every(token => normalizeName(technician?.name).includes(token)))
    return index < 0 ? null : remaining.splice(index, 1)[0]
  }).filter(Boolean)
  return [...preferred, ...remaining]
}

const elapsedMonths = (month, anchorMonth) => {
  const [year, monthNumber] = String(month || '').split('-').map(Number)
  const [anchorYear, anchorMonthNumber] = String(anchorMonth || '').split('-').map(Number)
  if (![year, monthNumber, anchorYear, anchorMonthNumber].every(Number.isFinite)) return 0
  return (year - anchorYear) * 12 + monthNumber - anchorMonthNumber
}

export const monthlyTeamRotation = (technicians, month, anchorMonth = '2026-01') => {
  const ordered = orderedMonthlyTechnicians(technicians)
  if (ordered.length !== 5) return []
  const rounds = [
    [[0, 1], [2, 3], [4]],
    [[0, 2], [1, 4], [3]],
    [[0, 3], [2, 4], [1]],
    [[0, 4], [1, 3], [2]],
    [[1, 2], [3, 4], [0]]
  ]
  const roundIndex = ((elapsedMonths(month, anchorMonth) % rounds.length) + rounds.length) % rounds.length
  return rounds[roundIndex].map(group => group.map(index => ordered[index]))
}
