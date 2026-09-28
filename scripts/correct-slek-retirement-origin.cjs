const { randomUUID } = require('node:crypto')
const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { setAuxiliaryPreference, appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const CLI = 'b5adcc21-d5aa-45fe-b90b-ea901fcd9730'
const ACTIVE = '9c1aae2f-8e50-4dab-89bc-9fd11547cf14'
const RETIREMENT = 'work-9eabc3cc-6dc2-4afa-907c-baa0086d6fdb'
const INSTALLATION = 'import-2026-07-28-PIG-6053-GONZALO-SLEK-Manzana-68-Lote-15-Bv-3-C-rdoba---Docta-Urbanizaci-n-Instalaci-n-nueva-Alarma'
const BACKUP = 'backup_slek_retirement_origin_20260928'
const { isDeepStrictEqual: equal } = require('node:util')

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = database()
  try {
    const result = await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`
      await tx`set local statement_timeout = '60s'`
      if (!apply) await tx`set transaction read only`
      if (apply) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      const current = await readApplicationState(tx)
      const cli = current.customers.find(c => c.customerId === CLI)
      const active = current.customers.find(c => c.customerId === ACTIVE)
      const other = current.customers.find(c => c.account === 'PIG-6512')
      const retirement = current.history.find(r => r.id === RETIREMENT)
      const installation = current.history.find(r => r.id === INSTALLATION)
      const technician = current.employees.find(e => String(e.id) === '1786103936809')
      if (cli?.account !== 'CLI-0132' || cli.name !== 'GONZALO SLEK' || cli.convertedFromAccount !== 'PIG-6053' ||
          active?.account !== 'PIG-6053' || active.name !== 'GONZALO SLEK' || other?.name !== 'ANDREA CECILIA GIACOMINO' ||
          retirement?.customerId !== CLI || retirement.status !== 'Completado' || retirement.date !== '2026-06-02' ||
          installation?.customerId !== CLI || installation.date !== '2026-07-28' || technician?.name !== 'Pascual Gonzalez') throw new Error('TARGET_CHANGED')
      if (current.history.filter(r => r.customerId === CLI).length !== 2) throw new Error('UNEXPECTED_REFERENCES')
      const next = structuredClone(current)
      const corrected = {
        ...cli, convertedFromAccount: 'PIG-6512', street: 'Manzana 21 Lote 9', locality: 'CHACRAS DEL NORTE 2',
        province: 'Córdoba', address: 'Manzana 21 Lote 9 - CHACRAS DEL NORTE 2', phone: '0351156227272',
        // Imported device/access metadata belonged to the unrelated active PIG-6053.
        fields: { Nombre: cli.name, 'Dealer/Cuenta': 'PIG-6512', Calle: 'Manzana 21 Lote 9', Localidad: 'CHACRAS DEL NORTE 2', Teléfono: '0351156227272' }
      }
      next.customers = next.customers.map(c => c.customerId === CLI ? corrected : c)
      const patches = {
        [RETIREMENT]: { address: corrected.address, phone: corrected.phone, time: '08:30', scheduledTime: '08:30',
          technicians: [technician.name], technicianIds: [technician.id],
          detail: 'RETIRO DE EQUIPO. Baja de PIG-6512 GONZALO SLEK - CHACRAS DEL NORTE 2. Tipo de servicio: Panel Titanium Hibrido (PC-732-T) + Comunicador Titanium (4G-MAX-T)' },
        [INSTALLATION]: { customerId: ACTIVE, clientAccount: active.account, client: `${active.account} ${active.name}`, clientNameAtService: active.name }
      }
      const changed = []
      next.history = next.history.map(r => {
        if (!patches[r.id]) return r
        changed.push({ path: `history.${r.id}`, before: r })
        return { ...r, ...patches[r.id] }
      })
      function visit(value, path) {
        if (!value || typeof value !== 'object') return
        const key = value.historyId || (value.taskId === retirement.sourceTaskId ? RETIREMENT : value.taskId)
        if (patches[key]) { changed.push({ path, before: structuredClone(value) }); Object.assign(value, patches[key]) }
        for (const [k, child] of Object.entries(value)) if (child && typeof child === 'object') visit(child, `${path}.${k}`)
      }
      visit(next.agenda, 'agenda')
      if (changed.length !== 4) throw new Error('UNEXPECTED_PROJECTIONS')
      next.revision = Number(current.revision) + 1
      if (apply) {
        if ((await tx`select key from pignus_preferences where key = ${BACKUP}`).length) throw new Error('ALREADY_APPLIED')
        await setAuxiliaryPreference(tx, BACKUP, JSON.stringify({ at: new Date().toISOString(), revision: current.revision, customer: cli, changed }))
        await coordinateStateWrite(tx, current, next, { mode: 'controlled', writeLegacy: async (db, after, before) => {
          await replaceCollections(db, after, before)
          await db`update pignus_preferences set value = ${String(after.revision)}, updated_at = now() where key = 'state_revision'`
        } })
        const verified = await readApplicationState(tx)
        if (!equal(verified.customers.find(c => c.customerId === CLI), corrected) ||
            !equal(verified.customers.find(c => c.customerId === ACTIVE), active) ||
            !equal(verified.customers.find(c => c.account === 'PIG-6512'), other) ||
            verified.history.length !== current.history.length || verified.customers.length !== current.customers.length ||
            !equal(verified.history.filter(r => patches[r.id]), next.history.filter(r => patches[r.id])) ||
            !equal(verified.agenda, next.agenda)) throw new Error('VERIFICATION_FAILED')
        await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(),
          user: { name: 'Corrección mediante Codex autorizada por el usuario', role: 'Sistema' },
          action: 'Corrigió origen de baja de Gonzalo Slek a PIG-6512 y restituyó instalación a PIG-6053',
          entity: 'Cliente e historial', entityId: CLI, before: { convertedFromAccount: cli.convertedFromAccount },
          after: { convertedFromAccount: corrected.convertedFromAccount, historyIds: Object.keys(patches) }, backupKey: BACKUP }])
      }
      return { applied: apply, account: corrected.account, origin: corrected.convertedFromAccount, retirementDate: retirement.date,
        retirementTime: '08:30', technician: technician.name, installationAccount: active.account, affectedReferences: changed.length,
        activeSubscribersUnchanged: true, backup: apply ? BACKUP : null }
    })
    console.log(JSON.stringify(result, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
main().catch(error => { console.error(error.code || error.message || 'CORRECTION_FAILED'); process.exitCode = 1 })
