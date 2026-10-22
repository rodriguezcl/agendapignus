const fs = require('node:fs')
const path = require('node:path')
const postgres = require('postgres')
const { workerSecret } = require('../api/_lib/ticket-mail-service.cjs')
const { schedulerStatus } = require('../api/_lib/ticket-mail-scheduler.cjs')

const JOB = 'agentec-ticket-mail-every-2-minutes'
const SECRET = 'agentec-ticket-mail-worker'
const COMMAND = 'SELECT agentec_private.dispatch_ticket_mail();'
const fail = message => { throw Object.assign(new Error(message), { safe: true }) }

function endpointFor(input) {
  let url
  try { url = new URL(input) } catch { fail('Indicá --url con el dominio HTTPS de la plataforma.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || !url.hostname.includes('.') ||
    !['/', '/api/tickets/mail/process'].includes(url.pathname)) fail('Usá el dominio HTTPS, sin credenciales, parámetros ni puertos adicionales.')
  return `${url.origin}/api/tickets/mail/process`
}

async function verifyEndpoint(endpoint, secret, fetcher = fetch) {
  // GET autenticado valida despliegue y credencial sin procesar ni enviar correo.
  const response = await fetcher(endpoint, {
    method: 'GET', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(20000)
  })
  if (response.status !== 405) fail(`El endpoint no está listo o la credencial no coincide (HTTP ${response.status}). El programador sigue pausado.`)
  const body = await response.json().catch(() => null)
  if (body?.error !== 'Método no permitido.') fail('La respuesta no corresponde al procesador de correo de Agentec. El programador sigue pausado.')
}

async function prepare(sql, endpoint, env) {
  const secret = workerSecret(env)
  if (!secret) fail('Falta una clave válida de servidor para autenticar el programador.')
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261022_ticket_mail_schedule.sql'), 'utf8')
  await sql.begin(async transaction => {
    await transaction`SET LOCAL log_parameter_max_length = 0`
    await transaction.unsafe(migration)
    await transaction`SELECT pg_advisory_xact_lock(181924, 22)`
    const rows = await transaction`SELECT id FROM vault.secrets WHERE name=${SECRET}`
    if (rows.length) await transaction`SELECT vault.update_secret(${rows[0].id}::uuid, ${secret}, ${SECRET}, 'Credencial exclusiva del programador de correo de Agentec')`
    else await transaction`SELECT vault.create_secret(${secret}, ${SECRET}, 'Credencial exclusiva del programador de correo de Agentec')`
    await transaction`INSERT INTO agentec_private.ticket_mail_schedule(id,endpoint) VALUES(TRUE,${endpoint})
      ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,request_id=NULL,requested_at=NULL`
    const [job] = await transaction`SELECT cron.schedule(${JOB}, '*/2 * * * *', ${COMMAND}) AS id`
    // La transacción publica el trabajo ya pausado; no existe una ventana de ejecución.
    await transaction`SELECT cron.alter_job(${job.id}::bigint, active := FALSE)`
  })
}

async function setActive(sql, active) {
  // Pausar antes de verificar permite que cualquier error deje un estado seguro.
  const rows = await sql`SELECT jobid FROM cron.job WHERE jobname=${JOB}`
  if (rows.length !== 1) fail('No existe el trabajo de correo. Ejecutá primero --prepare --confirm.')
  await sql`SELECT cron.alter_job(${rows[0].jobid}::bigint, active := FALSE)`
  if (!active) return
  await sql.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(181924, 22)`
    const [configuration] = await transaction`SELECT s.endpoint, v.decrypted_secret AS secret
      FROM agentec_private.ticket_mail_schedule s JOIN vault.decrypted_secrets v ON v.name=${SECRET} WHERE s.id=TRUE`
    if (!configuration?.secret) fail('Falta preparar la credencial del programador.')
    await verifyEndpoint(endpointFor(configuration.endpoint), configuration.secret)
    await transaction`SELECT cron.alter_job(${rows[0].jobid}::bigint, active := TRUE)`
  })
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const actions = ['--status', '--prepare', '--enable', '--disable'].filter(flag => argv.includes(flag))
  if (actions.length !== 1) fail('Elegí --status, --prepare --confirm, --enable --confirm o --disable --confirm.')
  const action = actions[0]
  if (action !== '--status' && !argv.includes('--confirm')) fail('La escritura de la programación requiere --confirm.')
  if (!env.DATABASE_URL) fail('Falta DATABASE_URL.')
  const endpoint = action === '--prepare' ? endpointFor(argv[argv.indexOf('--url') + 1]) : null
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15, idle_timeout: 5, onnotice() {} })
  try {
    if (action === '--prepare') await prepare(sql, endpoint, env)
    if (action === '--enable' || action === '--disable') await setActive(sql, action === '--enable')
    console.log(JSON.stringify(await schedulerStatus({ sql }), null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}

if (require.main === module) main().catch(error => {
  // Los errores del driver pueden contener parámetros secretos: no imprimir el objeto.
  console.error(error.safe ? error.message : `No se pudo configurar el programador (${String(error.code || 'ERROR').replace(/[^A-Z0-9_]/gi, '').slice(0, 40)}). Revisá la conexión y los permisos de mantenimiento.`)
  process.exitCode = 1
})

module.exports = { endpointFor, verifyEndpoint, prepare, setActive, main, JOB, SECRET }
