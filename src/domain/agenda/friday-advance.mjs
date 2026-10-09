export function fridayAdvanceDestination(day, sourceTeam, fridayPlan, today) {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.getUTCDay() !== 6) throw new Error('Solo se pueden adelantar servicios del sábado.')
  date.setUTCDate(date.getUTCDate() - 1)
  const friday = date.toISOString().slice(0, 10)
  if (friday < today) throw new Error('El viernes anterior ya pasó. Elegí otra fecha desde Reasignar equipo o fecha.')
  if (sourceTeam?.memberIds?.length !== 1 || sourceTeam?.members?.length !== 1) throw new Error('El sábado debe tener un único técnico asignado.')
  const teams = fridayPlan?.teams || []
  const existing = teams.find(team => team.memberIds?.length === 1 && String(team.memberIds[0]) === String(sourceTeam.memberIds[0]))
  const team = existing || {
    teamId: `friday-guard-${friday}-${sourceTeam.memberIds[0]}`,
    label: `Guardia · ${sourceTeam.members[0]}`,
    memberIds: [...sourceTeam.memberIds], members: [...sourceTeam.members], tasks: []
  }
  return { day: friday, team, plan: { ...fridayPlan, teams: existing ? teams : [...teams, team] }, index: existing ? teams.indexOf(existing) : teams.length }
}
