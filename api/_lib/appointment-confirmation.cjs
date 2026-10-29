const { emailAddress } = require('./ticket-mail.cjs')
const { scheduledDate } = require('./ticket-communications.cjs')
const notice = require('./appointment-notice.cjs')
const ready = (r, state) => notice.ready(r, state) && Boolean(notice.envelope(r, state).recipient)
function confirmations(previous, next) {
  return notice.changes(previous, next).filter(item => item.recipient)
}
function eligible(record, payload, state, now = Date.now()) {
  return ready(record, state) && notice.envelope(record, state).recipient === emailAddress(payload.recipient) &&
    record.date === payload.date && record.time === payload.time && record.date >= notice.today(now)
}
function message(item, record) {
  const paragraphs = [`Hola, ${item.client}:`, 'Te confirmamos la visita técnica para instalar tu alarma.', `Nuestro equipo te visitará el ${scheduledDate({ service: record })}.`, `Dirección de instalación: ${record.address}.`, `Técnicos asignados: ${(record.technicians || []).join(' / ') || 'Equipo técnico Pignus'}.`, 'Si necesitás modificar la visita o consultar algún detalle, podés responder a este correo.', 'Gracias por confiar en Pignus.', 'Equipo Pignus']
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  return { to: item.recipient, subject: 'Tu visita técnica está confirmada · Pignus', automatic: true, text: paragraphs.join('\n\n'), html: `<div style="font-family:Arial,sans-serif">${paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</div>` }
}
module.exports = { confirmations, eligible, message, ready }
