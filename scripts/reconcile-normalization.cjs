const fs = require('node:fs')
const path = require('node:path')
const { reconcileNormalization } = require('../api/_lib/normalization-reconciliation.cjs')
function readLocalBackups(root = path.join(__dirname, '../data')) {
  const { DatabaseSync } = require('node:sqlite')
  const backups = []
  for (const directory of [root, path.join(root, 'backups')]) {
    if (!fs.existsSync(directory)) continue
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.db')).sort()) {
      const file = path.join(directory, name)
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        const tables = new Set(db.prepare("select name from sqlite_master where type='table'").all().map(row => row.name))
        const history = tables.has('work_history') ? db.prepare('select data from work_history order by id').all().map(row => JSON.parse(row.data)) : []
        const row = tables.has('agendas') ? db.prepare("select data from agendas where id = 'current'").get() : null
        backups.push({ key: `local/${path.relative(root, file).replaceAll('\\', '/')}`, value: { history, agenda: row ? JSON.parse(row.data) : null } })
      } finally { db.close() }
    }
  }
  return backups
}
async function main() {
  const args = process.argv.slice(2)
  const accepted = new Set(['--production-read-only', '--file', '--details', '--local-backups'])
  for (let i = 0; i < args.length; i++) { if (!accepted.has(args[i])) throw new Error('Argumento inválido'); if (args[i] === '--file') i++ }
  const index = args.indexOf('--file'), remote = args.includes('--production-read-only')
  if ((index >= 0) === remote) throw new Error('Elegí una sola fuente')
  let input
  if (remote) {
    const { database, readState } = require('../api/_lib/database.cjs')
    const sql = database()
    try {
      input = await sql.begin(async tx => {
        await tx`set transaction isolation level repeatable read, read only`
        await tx`set local statement_timeout = '20000'`
        const state = await readState(tx)
        const backups = await tx`select key, value from pignus_preferences where key like 'backup_%' or key like 'repair_backup_%' order by key`
        const audit = (await tx`select data from pignus_audit_log order by occurred_at, id`).map(row => row.data)
        return { state, backups, audit }
      })
    } finally { await sql.end({ timeout: 5 }) }
  } else {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Falta archivo')
    input = JSON.parse(fs.readFileSync(args[index + 1], 'utf8'))
  }
  if (args.includes('--local-backups')) input.backups = [...(input.backups || []), ...readLocalBackups()]
  const report = reconcileNormalization(input.state, input)
  if (!args.includes('--details')) { delete report.records; delete report.unresolvedAgendaIssues }
  console.log(JSON.stringify(report, null, 2))
}
if (require.main === module) main().catch(() => { console.error('No se completó la conciliación. No se aplicaron cambios a producción.'); process.exitCode = 1 })
module.exports = { main, readLocalBackups }
