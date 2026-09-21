// Run before deploying the journey feature. Additive and safe for older app versions.
const { database } = require('../api/_lib/database.cjs')
async function main() {
  if (process.argv[2] !== '--apply') throw new Error('Usá --apply para confirmar la migración del estado Avance registrado.')
  const sql = database()
  try {
    await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`
      const [table] = await tx`select to_regclass('normalized_shadow.jobs') as present`
      if (!table.present) return
      const constraints = await tx`select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'normalized_shadow.jobs'::regclass and contype = 'c'`
      const status = constraints.find(item => item.conname === 'jobs_status_check')
      if (!status || !status.definition.includes('Pendiente') || !status.definition.includes('Completado')) throw new Error('La restricción de estados no coincide con la esperada. Revisá el esquema antes de migrar.')
      await tx`alter table normalized_shadow.jobs drop constraint jobs_status_check`
      await tx`alter table normalized_shadow.jobs add constraint jobs_status_check check (status in ('Pendiente','Completado','Avance registrado','Cancelado','Reprogramado','Requiere revisión'))`
    })
    console.log('Estado Avance registrado habilitado; no se modificaron servicios.')
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
