const JOB_NAME = 'agentec-ticket-mail-every-2-minutes'
const CRON_EXPRESSION = '*/2 * * * *'
const INTERVAL_MINUTES = 2
const ATTEMPT_STALE_MS = 6 * 60_000
const RESPONSE_STALE_MS = 90_000

const messages = {
  unconfigured: 'La ejecución automática todavía no está configurada.',
  paused: 'La ejecución automática está pausada.',
  waiting: 'Programado cada 2 minutos. Aguardando la primera ejecución.',
  running: 'La ejecución programada está en curso.',
  ok: 'La última ejecución programada finalizó correctamente.',
  busy: 'Se omitió el ciclo porque ya había una operación de correo en curso.',
  error: 'La ejecución automática necesita revisión.',
  stale: 'No se recibió una respuesta reciente de la ejecución automática.'
}

function timestamp(value) {
  if (!value) return null
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null
}

async function schedulerStatus({ sql, now = Date.now } = {}) {
  const result = {
    configured: false, active: false, intervalMinutes: INTERVAL_MINUTES,
    lastAttemptAt: null, lastHttpStatus: null, lastCompletedAt: null,
    state: 'unconfigured', message: messages.unconfigured
  }
  const state = value => ({ ...result, state: value, message: messages[value] })
  if (!sql) return result
  try {
    const [available] = await sql.unsafe(`SELECT to_regclass('cron.job') IS NOT NULL AS cron,
      to_regclass('agentec_private.ticket_mail_schedule') IS NOT NULL AS schedule,
      to_regclass('net._http_response') IS NOT NULL AS responses,
      to_regclass('cron.job_run_details') IS NOT NULL AS runs`)
    if (!available?.cron || !available.schedule || !available.responses) return result

    const [job] = await sql.unsafe('SELECT jobid,active,schedule FROM cron.job WHERE jobname=$1 LIMIT 1', [JOB_NAME])
    const [attempt] = await sql.unsafe('SELECT request_id,requested_at FROM agentec_private.ticket_mail_schedule WHERE id=true')
    if (!job || !attempt) return result
    result.configured = true
    result.active = job.active === true
    result.lastAttemptAt = timestamp(attempt.requested_at)

    if (available.runs) {
      const [run] = await sql.unsafe(`SELECT status,start_time,end_time FROM cron.job_run_details
        WHERE jobid=$1 ORDER BY start_time DESC NULLS LAST LIMIT 1`, [job.jobid])
      const startedAt = timestamp(run?.start_time)
      if (run?.status === 'failed' && startedAt && (!result.lastAttemptAt || startedAt > result.lastAttemptAt)) {
        // Un fallo SQL anterior al envío no crea una respuesta HTTP ni debe quedar esperando para siempre.
        result.lastAttemptAt = startedAt
        return state(result.active ? 'error' : 'paused')
      }
    }

    let response
    if (attempt.request_id !== null && attempt.request_id !== undefined) {
      // Sólo se leen datos de estado. La respuesta y los errores del servidor pueden contener datos privados.
      ;[response] = await sql.unsafe(`SELECT status_code,timed_out,created,
        error_msg IS NOT NULL AND error_msg <> '' AS has_error
        FROM net._http_response WHERE id=$1`, [attempt.request_id])
      if (response) {
        const code = Number(response.status_code)
        result.lastHttpStatus = Number.isInteger(code) && code >= 100 && code <= 599 ? code : null
        result.lastCompletedAt = timestamp(response.created)
      }
    }
    if (!result.active) return state('paused')
    if (job.schedule !== CRON_EXPRESSION) return state('error')
    if (!result.lastAttemptAt) return state('waiting')
    const elapsed = now() - new Date(result.lastAttemptAt).getTime()
    if (elapsed > ATTEMPT_STALE_MS) return state('stale')
    if (!response) return state(elapsed > RESPONSE_STALE_MS ? 'stale' : 'running')
    if (response.timed_out || response.has_error) return state('error')
    if (result.lastHttpStatus === 409) return state('busy')
    return state(result.lastHttpStatus >= 200 && result.lastHttpStatus < 300 ? 'ok' : 'error')
  } catch {
    return state('error')
  }
}

module.exports = { schedulerStatus, JOB_NAME, CRON_EXPRESSION, INTERVAL_MINUTES }
