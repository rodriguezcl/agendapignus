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

const legacyFiveTechnicianRounds = [
  [[0, 1], [2, 3], [4]],
  [[0, 2], [1, 4], [3]],
  [[0, 3], [2, 4], [1]],
  [[0, 4], [1, 3], [2]],
  [[1, 2], [3, 4], [0]]
]

const rotateRoundRobin = (values, round) => {
  let rotated = [...values]
  for (let index = 0; index < round; index += 1) rotated = [rotated[0], rotated.at(-1), ...rotated.slice(1, -1)]
  return rotated
}

const greatestCommonDivisor = (left, right) => right ? greatestCommonDivisor(right, left % right) : Math.abs(left)

const pairAndSoloTeams = (ordered, teamCount, monthIndex) => {
  const soloCount = teamCount * 2 - ordered.length
  const normalizedMonth = ((monthIndex % ordered.length) + ordered.length) % ordered.length
  const soloStart = (normalizedMonth * Math.max(1, soloCount)) % ordered.length
  const soloIds = new Set(Array.from({ length: soloCount }, (_, index) => String(ordered[(soloStart + index) % ordered.length].id)))
  const solos = ordered.filter(technician => soloIds.has(String(technician.id))).map(technician => [technician])
  const remaining = ordered.filter(technician => !soloIds.has(String(technician.id)))
  const soloCycle = soloCount ? ordered.length / greatestCommonDivisor(ordered.length, soloCount) : 1
  const pairingCycle = Math.floor(monthIndex / soloCycle)
  const round = remaining.length > 1 ? ((pairingCycle % (remaining.length - 1)) + remaining.length - 1) % (remaining.length - 1) : 0
  const rotated = rotateRoundRobin(remaining, round)
  const pairs = Array.from({ length: rotated.length / 2 }, (_, index) => [rotated[index], rotated[rotated.length - 1 - index]])
  return [...pairs, ...solos]
}

const balancedLargerTeams = (ordered, teamCount, monthIndex) => {
  const offset = ((monthIndex % ordered.length) + ordered.length) % ordered.length
  const rotated = ordered.map((_, index) => ordered[(index + offset) % ordered.length])
  const teams = Array.from({ length: teamCount }, () => [])
  rotated.forEach((technician, index) => {
    const pass = Math.floor(index / teamCount)
    const position = index % teamCount
    const teamIndex = pass % 2 ? teamCount - 1 - position : position
    teams[teamIndex].push(technician)
  })
  return teams.filter(team => team.length)
}

export const monthlyTeamRotation = (technicians, month, anchorMonth = '2026-01', requestedTeamCount = 3) => {
  const ordered = orderedMonthlyTechnicians(technicians)
  if (!ordered.length) return []
  const teamCount = Math.max(1, Math.min(ordered.length, Number(requestedTeamCount) || 1))
  const monthIndex = elapsedMonths(month, anchorMonth)
  if (ordered.length === 5 && teamCount === 3) {
    const roundIndex = ((monthIndex % legacyFiveTechnicianRounds.length) + legacyFiveTechnicianRounds.length) % legacyFiveTechnicianRounds.length
    return legacyFiveTechnicianRounds[roundIndex].map(group => group.map(index => ordered[index]))
  }
  return ordered.length <= teamCount * 2
    ? pairAndSoloTeams(ordered, teamCount, monthIndex)
    : balancedLargerTeams(ordered, teamCount, monthIndex)
}
