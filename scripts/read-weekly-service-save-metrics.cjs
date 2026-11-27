const { database } = require('../api/_lib/database.cjs')
const { readWeeklyServiceSaveSummary } = require('../api/_lib/weekly-service-save-metrics.cjs')

async function main() {
  const sql = database()
  try {
    const result = await sql.begin(async connection => {
      await connection`set transaction isolation level repeatable read, read only`
      await connection`set local statement_timeout = '10s'`
      return readWeeklyServiceSaveSummary({ connection, kind: 'sql' })
    })
    console.log(JSON.stringify(result))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch(error => {
  console.error('No se pudo consultar la medición de Agenda semanal.', error.code || error.name)
  process.exitCode = 1
})
