// Explicit, single-request smoke test. Never reads customers or service records.
const { randomBytes } = require('node:crypto')
const { configuration, signedPayload, deliver } = require('../api/_lib/appointment-whatsapp.cjs')
const { phoneNumber } = require('../api/_lib/appointment-notice.cjs')
async function main() {
  const sample = process.argv.includes('--sample'), send = process.argv.includes('--send-test')
  if (sample === send) throw Error('Elegí --sample (sin teléfono) o --send-test --phone=NUMERO_INTERNO.')
  const phone = phoneNumber((process.argv.find(arg => arg.startsWith('--phone=')) || '').slice(8))
  if (sample && phone) throw Error('Las muestras no llevan teléfono.')
  if (send && !phone) throw Error('Falta un teléfono interno válido para la prueba autorizada.')
  const config = configuration({ ...process.env, PIGNUS_GHL_ENABLED: 'true' })
  if (!config.enabled) throw Error('Configurá PIGNUS_GHL_WEBHOOK_URL y PIGNUS_SESSION_SECRET en el entorno local.')
  const item = { id: randomBytes(32).toString('hex'), serviceId: 'DEMO-NO-ES-UNA-VISITA', client: 'Prueba interna Pignus',
    recipient: sample ? 'cliente@example.com' : '', phone: sample ? '' : phone, date: '2026-11-02', time: '09:00',
    dateText: 'PRUEBA: lunes 2 de noviembre de 2026', address: 'PRUEBA SIN VISITA REAL · Córdoba', technicians: ['Equipo de prueba'] }
  const result = await deliver(signedPayload(item, process.env, true), config)
  console.log(JSON.stringify({ status: result.status, message: result.error || 'Solicitud aceptada por GHL; verificar entrega en la conversación. No se reintentará.' }))
  if (!['accepted', 'draft'].includes(result.status)) process.exitCode = 1
}
main().catch(() => { console.error('No se pudo completar la prueba. Revisá la configuración y el historial de GHL antes de repetir.'); process.exitCode = 1 })
