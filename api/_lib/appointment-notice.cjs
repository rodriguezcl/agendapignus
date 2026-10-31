const { createHash } = require('node:crypto')
const { installation, installationType, describe } = require('./installation-communications.cjs')
const { emailAddress } = require('./ticket-mail.cjs')
const { customerForRecord } = require('./granular-read-policy.cjs')
const clean = value => String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim()
const hash = value => createHash('sha256').update(value).digest('hex')
const today = now => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })

// Argentine national formats are accepted; international numbers require +/00.
// Never concatenate two contacts or guess the area code of a local number.
function phoneNumber(value) {
  const raw = clean(value)
  if (!raw || /[^\d+() .-]/.test(raw)) return ''
  let digits = raw.replace(/\D/g, '')
  const international = raw.startsWith('+') || raw.startsWith('00')
  if (raw.startsWith('00')) digits = digits.slice(2)
  if (!international) {
    if (/^549\d{10}$/.test(digits) || /^54\d{10}$/.test(digits)) digits = digits
    else {
      digits = digits.replace(/^0/, '')
      if (digits.length === 12) digits = digits.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2')
      if (digits.length !== 10) return ''
      digits = `549${digits}`
    }
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : ''
}

function ready(record, state = { history: [] }) {
  if (!record || !installation(record) || record.awaitingConfirmation === true || record.startedAt || record.completedAt ||
    !['Pendiente', undefined, ''].includes(record.status) || record.technicalStatus || record.technicianRequest ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time || '') || !clean(record.address)) return false
  if (!record.serviceJourney) return true
  const visits = (state.history || []).filter(item => item.serviceJourney?.id === record.serviceJourney.id && !['Cancelado', 'Reprogramado'].includes(item.status))
    .sort((a, b) => (a.serviceJourney.index || 1) - (b.serviceJourney.index || 1) || String(a.date).localeCompare(String(b.date)))
  return String(visits[0]?.id || record.id) === String(record.id)
}

function envelope(record, state = {}) {
  const customer = customerForRecord(record, state)
  const client = clean(customer?.name || record.clientNameAtService || record.client || 'cliente')
  const recipient = emailAddress(record.formEmail) || emailAddress(customer?.email) || ''
  const phone = phoneNumber(record.phone || customer?.phone)
  const technicians = [...new Set((record.technicians || []).map(clean).filter(Boolean))]
  const dateText = new Date(`${record.date}T12:00:00-03:00`).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const scheduleKey = `${record.serviceJourney?.id || record.id}:${record.date}:${record.time}`
  return { id: hash(`appointment:${scheduleKey}`), kind: 'appointment', serviceId: String(record.id), customerId: String(record.customerId || customer?.customerId || ''),
    client, account: customer?.account || record.clientAccount || '', recipient, phone, technicians, date: record.date, time: record.time,
    address: clean(record.address), dateText, scheduleKey, ...describe(installationType(record)) }
}

function changes(previous, next, channel = 'email') {
  const old = new Map((previous.history || []).map(record => [String(record.id), record]))
  return (next.history || []).filter(record => {
    if (!ready(record, next)) return false
    const before = old.get(String(record.id))
    if (!ready(before, previous)) return true
    const current = envelope(record, next), prior = envelope(before, previous)
    const recipientKey = channel === 'whatsapp' ? 'phone' : 'recipient'
    return current.scheduleKey !== prior.scheduleKey || current.installationType !== prior.installationType || current[recipientKey] !== prior[recipientKey] || (channel === 'whatsapp' && current.recipient !== prior.recipient)
  }).map(record => envelope(record, next))
}

function webhookPayload(item, isTest = false) {
  const words = item.client.split(/\s+/)
  return { event: 'installation.confirmed', eventId: `whatsapp-${item.id}`, isTest, serviceId: item.serviceId,
    firstName: words[0], lastName: words.slice(1).join(' '), customerName: item.client,
    email: item.recipient, phone: item.phone, appointmentDate: item.date, appointmentTime: item.time,
    appointmentDateText: item.dateText, address: item.address, technicians: item.technicians.join(' / ') || 'Equipo técnico Pignus',
    serviceType: describe(item.installationType).serviceType, installationDescription: describe(item.installationType).installationDescription }
}

module.exports = { clean, hash, today, phoneNumber, ready, envelope, changes, webhookPayload }
