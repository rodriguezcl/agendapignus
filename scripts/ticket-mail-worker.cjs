const { ticketMailConfig, safeMailError } = require('../api/_lib/ticket-mail.cjs')
const { runTicketMail } = require('../api/_lib/ticket-mail-worker.cjs')

async function main() {
  const config = ticketMailConfig()
  if (!config.enabled) return console.log(JSON.stringify({ enabled: false, message: 'Correo de Tickets deshabilitado. No se abrió ninguna conexión.' }))
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Falta la conexión de datos del worker.'), { code: 'MAIL_DATABASE_CONFIGURATION' })
  const postgres = require('postgres')
  const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
  const { postgresTicketMailStore } = require('../api/_lib/ticket-mail-store.cjs')
  const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false, idle_timeout: 5, connect_timeout: 15, ssl: 'require' })
  try {
    const ticketStore = createTicketStore({ sql }), mailStore = postgresTicketMailStore(sql)
    if (process.argv.includes('--status')) {
      await ticketStore.ensure()
      console.log(JSON.stringify({ enabled: true, mode: config.mode, ...await mailStore.status(config.mailboxKey) }))
    } else {
      const result = await runTicketMail({ config, mailStore, ticketStore })
      console.log(JSON.stringify(result))
    }
  } finally { await sql.end({ timeout: 5 }) }
}

if (require.main === module) main().catch(problem => { console.error(JSON.stringify(safeMailError(problem))); process.exitCode = 1 })
module.exports = { main }
