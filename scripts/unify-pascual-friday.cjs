const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const { unifyFridaySoloTeams } = require('../api/_lib/friday-solo-teams.cjs')
const day = '2026-11-20'
const technicianId = '1786103936809'
const targetId = '05439b7c-37ef-462e-9335-ea8cc6630fd1'
const sourceId = '3bcdeae9-11f2-40f5-8617-839e39683dd9'
const recordId = 'work-c1ace07e-5041-4679-834b-998c78f738cb'
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw Error('Argumento inválido')
  const apply = process.argv.includes('--apply'), sql = database()
  try {
    const result = await sql.begin(async tx => {
      await tx`set local lock_timeout = '10s'`
      await tx`set local statement_timeout = '45s'`
      if (!apply) await tx`set transaction read only`
      if (apply) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      const current = await readApplicationState(tx)
      const before = current.agenda?.weekly?.[day]
      const source = before?.teams?.find(team => team.teamId === sourceId)
      if (!source) {
        assert.equal(current.history.find(r => r.id === recordId)?.teamId, targetId)
        return { applied: false, alreadyUnified: true, day }
      }
      const target = before.teams.find(team => team.teamId === targetId)
      assert.deepEqual(source.memberIds.map(String), [technicianId])
      assert.deepEqual(target.memberIds.map(String), [technicianId])
      assert.deepEqual(source.tasks.map(task => task.historyId), [recordId])
      const record = current.history.find(r => r.id === recordId)
      assert.equal(record.date, day)
      assert.equal(record.time, '16:30')
      assert.equal(record.status, 'Pendiente')
      const next = unifyFridaySoloTeams(current, current, { days: [day] })
      assert.notEqual(next, current)
      assert.equal(next.history.length, current.history.length)
      const beforeRecords = current.history.map(({ team, teamId, ...item }) => item)
      const afterRecords = next.history.map(({ team, teamId, ...item }) => item)
      assert.deepEqual(afterRecords, beforeRecords)
      assert.deepEqual(next.history.filter(r => r.id !== recordId), current.history.filter(r => r.id !== recordId))
      assert.equal(next.history.find(r => r.id === recordId).teamId, targetId)
      const after = next.agenda.weekly[day]
      assert.deepEqual(after.teams.filter(t => t.teamId !== targetId), before.teams.filter(t => ![sourceId, targetId].includes(t.teamId)))
      for (const key of Object.keys(current.agenda.weekly)) if (key !== day) assert.deepEqual(next.agenda.weekly[key], current.agenda.weekly[key])
      require('../api/_lib/completed-service-policy.cjs').assertCompletedServices(next, current)
      require('../api/_lib/scheduling-validation.cjs').validateChangedAgendaSchedules(next, current)
      if (apply) {
        next.revision = Number(current.revision) + 1
        await coordinateStateWrite(tx, current, next, { mode: 'controlled', writeLegacy: async (db, state, previous) => {
          await replaceCollections(db, state, previous)
          await db`update pignus_preferences set value = ${String(state.revision)}, updated_at = now() where key = 'state_revision'`
        } })
        const actor = current.employees.find(e => String(e.id) === '1786158982393')
        await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(), user: { id: actor.id, name: actor.name, role: actor.role }, action: 'Unificó equipos individuales del viernes conservando la guardia adelantada', entity: 'Agenda técnica', entityId: day, before, after }])
      }
      const merged = after.teams.find(t => t.teamId === targetId)
      return { applied: apply, day, team: merged.label, technician: merged.members, services: merged.tasks.map(t => ({ time: t.time, service: t.service, status: t.status })), historyCountUnchanged: true, otherDaysUnchanged: true }
    })
    console.log(JSON.stringify(result, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1 })
