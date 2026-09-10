const fs = require('node:fs')
const { analyzeNormalization } = require('../api/_lib/normalization-analysis.cjs')

async function main() {
  const args = process.argv.slice(2)
  const allowed = new Set(['--production-read-only', '--file', '--rehearse', '--details'])
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('Argumento no admitido. Este comando no permite aplicar cambios remotos.')
    if (args[i] === '--file') i++
  }
  const fileIndex = args.indexOf('--file'), production = args.includes('--production-read-only')
  if ((fileIndex >= 0) === production) throw new Error('Elegí exactamente una fuente: --file archivo.json o --production-read-only.')
  let state
  if (production) {
    const { database, readState } = require('../api/_lib/database.cjs')
    const sql = database()
    try {
      state = await sql.begin(async transaction => {
        await transaction`set transaction isolation level repeatable read, read only`
        await transaction`set local statement_timeout = '20000'`
        return readState(transaction)
      })
    } finally { await sql.end({ timeout: 5 }) }
  } else {
    if (!args[fileIndex + 1] || args[fileIndex + 1].startsWith('--')) throw new Error('Falta el archivo JSON de origen.')
    state = JSON.parse(fs.readFileSync(args[fileIndex + 1], 'utf8'))
  }
  const report = analyzeNormalization(state)
  const output = { sourceFingerprint: report.sourceFingerprint, revision: report.revision, summary: report.summary, productionModified: false }
  if (args.includes('--details')) output.issues = report.issues // IDs and locations only; never original payloads or credentials.
  if (args.includes('--rehearse')) output.rehearsal = await require('../api/_lib/normalization-rehearsal.cjs').rehearseNormalization(state)
  console.log(JSON.stringify(output, null, 2))
}
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: 'No se completó el análisis o ensayo. No se aplicaron cambios a producción.', code: error.code || 'NORMALIZATION_FAILED',
    ...(error.normalizationTable ? { table: error.normalizationTable, batchOffset: error.normalizationBatchOffset } : {}), ...(error.summary ? { summary: error.summary } : {}) }))
  process.exitCode = 1
})
module.exports = { main }
