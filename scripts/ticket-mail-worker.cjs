const { safeMailError } = require('../api/_lib/ticket-mail.cjs')

async function main() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Falta la conexión de datos del worker.'), { code: 'MAIL_DATABASE_CONFIGURATION' })
  const postgres = require('postgres')
  const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
  const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false, idle_timeout: 5, connect_timeout: 15, ssl: 'require' })
  try {
    const ticketStore = createTicketStore({ sql })
    await ticketStore.ensure()
    const service = require('../api/_lib/ticket-mail-service.cjs').createMailService({ sql, ticketStore })
    if (process.argv.includes('--status')) {
      const { enabled, status, settings } = await service.snapshot()
      console.log(JSON.stringify({ enabled, mode: settings.mode, ...status }))
    } else {
      const result = await service.process({ maxRunMs: 45000 })
      console.log(JSON.stringify(result))
    }
  } finally { await sql.end({ timeout: 5 }) }
}

if (require.main === module) main().catch(problem => { console.error(JSON.stringify(safeMailError(problem))); process.exitCode = 1 })
module.exports = { main }
