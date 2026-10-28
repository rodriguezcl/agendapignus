const { createHash } = require('node:crypto')
const { installation } = require('./alarm-zones.cjs')
const { emailAddress } = require('./ticket-mail.cjs')
const { customerForRecord } = require('./granular-read-policy.cjs')
const { scheduledDate } = require('./ticket-communications.cjs')
const clean = value => String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim()
const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]))
const account = (record, state) => clean(customerForRecord(record, state)?.account || record?.clientAccount)
const linked = (record, state) => Boolean(record?.customerId && !record.subscriberReservation && /^PIG-\d+$/i.test(account(record, state)))
const active = record => record && !['Cancelado'].includes(record.status) && record.technicalStatus !== 'Cancelado'

function confirmations(previous, next) {
  const old = new Map((previous.history || []).map(record => [String(record.id), record]))
  const found = new Map()
  for (const record of next.history || []) {
    const before = old.get(String(record.id))
    const linkSaved = before && (String(before.customerId || '') !== String(record.customerId || '') || before.subscriberReservation && !record.subscriberReservation || before.clientAccount !== record.clientAccount)
    // Only a saved account link triggers this mail, never imports or ordinary edits.
    if (!linkSaved || linked(before, previous) || !linked(record, next) || !active(record) || !installation(record)) continue
    const visits = record.serviceJourney ? next.history.filter(item => item.serviceJourney?.id === record.serviceJourney.id && active(item)).sort((a,b) => (a.serviceJourney.index || 1) - (b.serviceJourney.index || 1)) : [record]
    const first = visits[0] || record
    if (!visits.some(item => item.form === 'Completo')) continue
    const customer = customerForRecord(record, next)
    const key = `registration:${record.serviceJourney?.id || record.id}`
    const id = createHash('sha256').update(key).digest('hex')
    found.set(id, { id, kind:'registration', serviceId:String(first.id), serviceIds:visits.map(item => String(item.id)), customerId:String(record.customerId), account:account(record,next), client:clean(customer?.name || record.clientNameAtService || record.client), recipient:visits.map(item => emailAddress(item.formEmail)).find(Boolean) || '', technicians:[], date:first.date, time:first.time || first.scheduledTime })
  }
  return [...found.values()]
}

function eligible(record, payload, state) {
  return active(record) && installation(record) && linked(record, state) && String(record.customerId) === payload.customerId && account(record,state) === payload.account
}

function message(item, record = item) {
  const appointment = scheduledDate({service:record})
  const paragraphs = [
    `Hola, ${item.client}:`,
    'Gracias por completar el formulario de alta. Ya registramos tu cuenta y la vinculamos con el servicio agendado.',
    `Tu número de cuenta es ${item.account}.`,
    record.status === 'Completado' ? 'La instalación figura completada en nuestra agenda.' : appointment ? `Tu visita está programada para el ${appointment}.` : 'Nos pondremos en contacto para confirmar los detalles de la visita.',
    'Si tenés alguna consulta, podés responder a este correo. Gracias por confiar en Pignus.',
    'Equipo Pignus'
  ]
  return { to:item.recipient, subject:`Confirmación de alta · ${item.account}`, automatic:true, text:paragraphs.join('\n\n'), html:`<div style="font-family:Arial,sans-serif;color:#303741;max-width:560px">${paragraphs.map(text => `<p>${escape(text)}</p>`).join('')}</div>` }
}

module.exports = { confirmations, eligible, message, linked }
