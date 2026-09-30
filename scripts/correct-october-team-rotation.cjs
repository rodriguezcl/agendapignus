const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { setAuxiliaryPreference, appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual: equal } = require('node:util')
const BACKUP = 'backup_october_team_rotation_20260930'
const MONTH = '2026-10'
async function plan(current) {
  const { monthlyTeamRotation, monthlyEligibleTechnicians } = await import('../src/domain/agenda/monthly-team-rotation.mjs')
  const { roleCode, normalizeRoleName } = await import('../src/domain/access/permissions.mjs')
  const staff = current.employees.map(e => ({ ...e, roleCode: roleCode(current.roles.find(r => String(r.id) === String(e.roleId)) || current.roles.find(r => normalizeRoleName(r.name) === normalizeRoleName(e.role))) }))
  const groups = monthlyTeamRotation(monthlyEligibleTechnicians(staff), MONTH, '2026-01', 3)
  if (groups.flat().length !== 5 || groups.length !== 3) throw new Error('Cambió la dotación esperada.')
  const next = structuredClone(current), weekly = next.agenda.weekly
  const config = weekly._monthlyTeams[MONTH]
  if (config.teams.length !== 3) throw new Error('Cambió la configuración mensual.')
  const templates = config.teams.map((team, i) => ({ ...team, memberIds: groups[i].map(t => t.id), members: groups[i].map(t => t.name), technicianIds: groups[i].map(t => t.id), technicians: groups[i].map(t => t.name) }))
  config.teams = templates
  config.configurationHistory = [...(config.configurationHistory || []), { id: randomUUID(), type: 'teams', period: MONTH, at: new Date().toISOString(), user: { name: 'Corrección autorizada por usuario' }, before: current.agenda.weekly._monthlyTeams[MONTH].teams, after: templates }]
  const byId = new Map(templates.map(t => [String(t.teamId), t]))
  const eligibleDay = day => day?.startsWith(MONTH + '-') && ![0, 6].includes(new Date(day + 'T12:00:00').getDay())
  const days = []
  function updateTeams(teams) {
    for (const team of teams || []) {
      const template = byId.get(String(team.teamId))
      if (!template) throw new Error('Equipo diario no reconocido: ' + team.teamId)
      team.memberIds = [...template.memberIds]; team.members = [...template.members]
      if (team.technicianIds) team.technicianIds = [...template.memberIds]
      if (team.technicians) team.technicians = [...template.members]
      for (const task of team.tasks || []) if (!task.vehicleControl) {
        if (task.technicianIds) task.technicianIds = [...template.memberIds]
        if (task.technicians) task.technicians = [...template.members]
      }
    }
  }
  for (const [day, entry] of Object.entries(weekly)) if (eligibleDay(day)) { updateTeams(entry.teams); days.push(day) }
  if (eligibleDay(next.agenda.date)) updateTeams(next.agenda.teams)
  let records = 0
  for (const record of next.history) if (eligibleDay(record.date) && !record.vehicleControl) {
    const template = byId.get(String(record.teamId))
    if (!template || record.status !== 'Pendiente' || record.startedAt || record.technicalReportedAt) throw new Error('Servicio requiere revisión: ' + record.id)
    record.technicianIds = [...template.memberIds]; record.technicians = [...template.members]; records++
  }
  validateChangedAgendaSchedules(next, current)
  next.revision = Number(current.revision) + 1
  return { next, summary: { teams: templates.map(t => ({ team: t.label, members: t.members })), days, records } }
}
async function main() {
  const sql = database(), apply = process.argv.includes('--apply'), rehearse = process.argv.includes('--rehearse')
  const rollback = new Error('REHEARSAL_ROLLBACK'); let result
  try {
    try { await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`
      await tx`set local statement_timeout = '60s'`
      if (apply || rehearse) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      const current = await readApplicationState(tx)
      const { next, summary } = await plan(current)
      result = { applied: apply, rehearsal: rehearse, ...summary }
      if (!(apply || rehearse)) return
      if ((await tx`select key from pignus_preferences where key = ${BACKUP}`).length) throw new Error('Corrección ya aplicada.')
      await setAuxiliaryPreference(tx, BACKUP, JSON.stringify({ at: new Date().toISOString(), revision: current.revision, agenda: current.agenda, history: current.history.filter(r => r.date?.startsWith(MONTH)) }))
      await coordinateStateWrite(tx, current, next, { mode: 'controlled', writeLegacy: async (db, after, before) => {
        await replaceCollections(db, after, before)
        await db`update pignus_preferences set value = ${String(after.revision)}, updated_at = now() where key = 'state_revision'`
      } })
      const verified = await readApplicationState(tx)
      if (!equal(verified.agenda, next.agenda) || !equal(verified.history, next.history) || !equal(verified.customers, current.customers)) throw new Error('Falló la verificación.')
      await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(), user: { name: 'Corrección autorizada por usuario', role: 'Sistema' }, action: 'Aplicó rotación de octubre solo con rol Técnico', entity: 'Equipos mensuales', entityId: MONTH, after: summary, backupKey: BACKUP }])
      result.backup = BACKUP
      if (rehearse) throw rollback
    }) } catch (error) { if (error !== rollback) throw error }
    console.log(JSON.stringify(result, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1 })
module.exports = { plan }
