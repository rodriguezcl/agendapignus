const { scheduledDate } = require('./ticket-communications.cjs')
const notice = require('./appointment-notice.cjs')
const ready = (r, state) => notice.ready(r, state) && Boolean(notice.envelope(r, state).recipient)
function confirmations(previous, next) {
  return notice.changes(previous, next).filter(item => item.recipient)
}
function eligible(record, payload, state, now = Date.now()) {
  return require('./appointment-delivery.cjs').current(record, payload, state, 'email', now)
}
function message(item, record) {
  const { installationType, describe } = require('./installation-communications.cjs')
  const paragraphs = item.technicalCancellation
    ? [`Hola, ${item.client}:`, `No fue posible realizar la visita técnica prevista para el ${item.dateText} a las ${item.time} hs en ${item.address}.`, 'Si querés solicitar una nueva fecha, por favor respondé a este correo o comunicate con Atención al Cliente de Pignus para coordinarla.', 'La nueva visita quedará sujeta a coordinación y confirmación.', 'Gracias por tu comprensión.', 'Equipo Pignus']
    : item.cancelledNotice
    ? [`Hola, ${item.client}:`, `La visita técnica prevista para el ${item.dateText} a las ${item.time} hs en ${item.address} fue cancelada.`, 'El equipo no concurrirá en ese horario. Podés responder a este correo para coordinar una nueva visita.', 'Equipo Pignus']
    : [`Hola, ${item.client}:`, `${item.immediateUpdate ? 'Actualizamos los datos de la visita técnica' : 'Te confirmamos la visita técnica'} para instalar ${describe(installationType(record)).installationDescription}.`, `Nuestro equipo te visitará el ${scheduledDate({ service: record })}.`, `Dirección de instalación: ${record.address}.`, `Técnicos asignados: ${(record.technicians || []).join(' / ') || 'Equipo técnico Pignus'}.`, 'Si necesitás modificar la visita o consultar algún detalle, podés responder a este correo.', 'Gracias por confiar en Pignus.', 'Equipo Pignus']
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  return { to: item.recipient, subject: item.cancelledNotice ? 'Cancelación de tu visita técnica · Pignus' : item.immediateUpdate ? 'Actualización de tu visita técnica · Pignus' : 'Tu visita técnica está confirmada · Pignus', automatic: true, text: paragraphs.join('\n\n'), html: `<div style="font-family:Arial,sans-serif">${paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</div>` }
}
module.exports = { confirmations, eligible, message, ready }
