// One-off, explicitly authorized administrative regularization. No service reopening.
const postgres = require('postgres')
const { randomUUID } = require('node:crypto')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { replaceCollections } = require('../api/_lib/database.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const { synchronizeAgendaAdvance } = require('../api/_lib/service-advance.cjs')
const recordId = 'work-9fbd7c95-d6ab-453e-ace7-c61e2a59dc19'
const apply = process.argv.includes('--apply')
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 10 })
  try {
    const result = await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`
      await tx`set local statement_timeout = '30s'`
      if (!apply) await tx`set transaction read only`
      if (apply) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      const current = await readApplicationState(tx)
      const previous = current.history.find(r => String(r.id) === recordId)
      if (!previous || previous.date !== '2026-09-25' || previous.client !== 'PIG-6015 EMILIANO INCHAUSTI' ||
          previous.status !== 'Requiere revisión' || previous.technicalStatus !== 'Reprogramación solicitada' ||
          previous.technicalObservation !== 'Cliente no se encuentra en la casa' ||
          previous.technicalReportedAt !== '2026-09-25T15:21:53.942Z' ||
          previous.advanceRequest?.status !== 'pending' || previous.advanceRequest.requestedAt !== '2026-09-25T15:21:34.730Z') {
        throw Object.assign(new Error('El registro cambió: no se aplicó la regularización.'), { code: 'TARGET_CHANGED' })
      }
      const actor = current.employees.find(e => String(e.id) === '1786158982393')
      if (actor?.name !== 'Leonardo Rodríguez' || String(actor.roleId) !== '1') throw Object.assign(new Error('Administrador no verificado'), { code: 'ACTOR_MISMATCH' })
      const at = new Date().toISOString()
      const next = { ...previous, advanceRequest: { ...previous.advanceRequest, status: 'approved', resolvedAt: at,
        resolvedById: actor.id, resolvedByName: actor.name, approvedAfterReport: true,
        resolutionNote: 'Aprobación posterior al informe, autorizada expresamente por Administración mediante Codex. Se conserva la observación y la reprogramación pendiente, sin cambiar horarios ni reabrir el servicio.' } }
      if (apply) {
        const state = structuredClone(current)
        state.history = state.history.map(r => String(r.id) === recordId ? next : r)
        state.agenda = synchronizeAgendaAdvance(state.agenda, next)
        state.revision = Number(current.revision) + 1
        await coordinateStateWrite(tx, current, state, { mode: 'controlled', writeLegacy: async (db, after, before) => {
          await replaceCollections(db, after, before)
          await db`update pignus_preferences set value = ${String(after.revision)}, updated_at = now() where key = 'state_revision'`
        } })
        await appendOperationalAudit(tx, [{ id: randomUUID(), at, user: { id: actor.id, name: actor.name, role: actor.role },
          action: 'Aprobó adelanto posterior al informe mediante Codex (autorización expresa)', entity: 'Servicio / historial',
          entityId: recordId, before: previous, after: next }])
      }
      return { applied: apply, recordId, status: next.status, technicalStatus: next.technicalStatus,
        observation: next.technicalObservation, time: next.time, advanceRequest: next.advanceRequest }
    })
    console.log(JSON.stringify(result, null, 2))
  } finally { await sql.end({ timeout: 2 }) }
}
main().catch(error => { console.error(error.code || 'REGULARIZATION_FAILED'); process.exitCode = 1 })
