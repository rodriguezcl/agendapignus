const { createHash } = require('node:crypto')
const { emailAddress } = require('./ticket-mail.cjs')
const { scheduledDate } = require('./ticket-communications.cjs')
const ready = r => Boolean(r?.salesBooking && r.awaitingConfirmation === false && r.form === 'Completo' && emailAddress(r.formEmail) && !['Cancelado', 'Reprogramado'].includes(r.status))
function confirmations(previous, next) {
  const old = new Map((previous.history || []).map(r => [String(r.id), r]))
  return (next.history || []).filter(r => ready(r) && (!ready(old.get(String(r.id))) || emailAddress(old.get(String(r.id))?.formEmail) !== emailAddress(r.formEmail))).map(r => ({
    id: createHash('sha256').update(`appointment:${r.serviceJourney?.id || r.id}`).digest('hex'), kind: 'appointment', serviceId: String(r.id), customerId: String(r.customerId || ''), recipient: emailAddress(r.formEmail), client: r.clientNameAtService || r.client, account: r.clientAccount || '', technicians: r.technicians || [], date: r.date, time: r.time
  }))
}
function eligible(record, payload) { return ready(record) && emailAddress(record.formEmail) === payload.recipient }
function message(item, record) {
  const paragraphs = [`Hola, ${item.client}:`, 'Recibimos tu formulario y confirmamos la visita para instalar tu alarma.', `Nuestro equipo te visitará el ${scheduledDate({ service: record })}.`, `Dirección de instalación: ${record.address}.`, 'Si necesitás modificar la visita o consultar algún detalle, podés responder a este correo.', 'Gracias por confiar en Pignus.', 'Equipo Pignus']
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  return { to: item.recipient, subject: 'Tu visita técnica está confirmada · Pignus', automatic: true, text: paragraphs.join('\n\n'), html: `<div style="font-family:Arial,sans-serif">${paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</div>` }
}
module.exports = { confirmations, eligible, message, ready }
