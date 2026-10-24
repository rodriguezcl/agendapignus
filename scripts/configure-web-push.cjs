const fs = require('node:fs'), path = require('node:path')
const postgres = require('postgres')
const { workerSecret } = require('../api/_lib/web-push.cjs')
const JOB = 'pignus-web-push-every-minute', SECRET = 'pignus-web-push-worker'
async function main(args = process.argv.slice(2)) {
  const action = args.find(arg => ['--prepare','--enable','--disable','--status'].includes(arg))
  if (!action || action !== '--status' && !args.includes('--confirm')) throw new Error('Indicá acción y --confirm para modificar la configuración.')
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false, connect_timeout: 15, onnotice() {} })
  try {
    if (action === '--prepare') {
      const origin = new URL(args[args.indexOf('--url') + 1])
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Dominio HTTPS inválido.')
      const secret = workerSecret()
      if (!secret) throw new Error('Falta el secreto de sesión del servidor.')
      const keys = require('web-push').generateVAPIDKeys()
      await sql.begin(async tx => {
        await tx`set local log_parameter_max_length=0`
        await tx`select pg_advisory_xact_lock(181924,24)`
        await tx.unsafe(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261024_web_push.sql'),'utf8'))
        await tx`insert into pignus_push_config(id,public_key,private_key,subject) values(true,${keys.publicKey},${keys.privateKey},${origin.origin}) on conflict(id) do nothing`
        await tx.unsafe(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261024_web_push_schedule.sql'),'utf8'))
        const [stored] = await tx`select id from vault.secrets where name=${SECRET}`
        if (stored) await tx`select vault.update_secret(${stored.id}::uuid,${secret},${SECRET},'Credencial exclusiva Web Push')`
        else await tx`select vault.create_secret(${secret},${SECRET},'Credencial exclusiva Web Push')`
        await tx`insert into agentec_private.push_schedule(id,endpoint) values(true,${origin.origin+'/api/push/process'}) on conflict(id) do update set endpoint=excluded.endpoint`
        const [job] = await tx`select cron.schedule(${JOB},'* * * * *','SELECT agentec_private.dispatch_web_push();') as id`
        await tx`select cron.alter_job(${job.id}::bigint, active:=false)`
      })
    }
    if (['--enable','--disable'].includes(action)) {
      const [job] = await sql`select jobid from cron.job where jobname=${JOB}`
      if (!job) throw new Error('Primero prepará la configuración.')
      await sql`select cron.alter_job(${job.jobid}::bigint, active:=false)`
      if (action === '--enable') {
        const [config] = await sql`select endpoint from agentec_private.push_schedule where id=true`
        const response = await fetch(config.endpoint, { headers: { Authorization: `Bearer ${workerSecret()}` }, redirect: 'error', signal: AbortSignal.timeout(20000) })
        if (response.status !== 405 || (await response.json()).error !== 'Método no permitido.') throw new Error('El despliegue no está listo; el envío quedó pausado.')
        await sql`select cron.alter_job(${job.jobid}::bigint, active:=true)`
      }
    }
    const [job] = await sql`select active,schedule from cron.job where jobname=${JOB}`
    const [counts] = await sql`select count(*)::int as devices from pignus_push_subscriptions`
    console.log(JSON.stringify({ active: job?.active || false, schedule: job?.schedule, ...counts }))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(`No se pudo configurar Web Push (${String(error.code || 'CONFIGURATION_ERROR').replace(/[^A-Z0-9_]/gi,'').slice(0,40)}). No se muestran claves ni datos privados.`); process.exitCode=1 })
module.exports = { main }
