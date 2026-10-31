const experience = require('./installation-experience.cjs')
const notice = require('./appointment-notice.cjs')
const { installation, describe } = require('./installation-communications.cjs')
const { isIntermediate } = require('./service-journeys.cjs')
const { customerForRecord } = require('./granular-read-policy.cjs')

function ready(record, state) {
  return experience.completed(record) && installation(record) && !isIntermediate(record, state.history)
}

function envelope(record, state) {
  const item = experience.envelope(record, state)
  const customer = customerForRecord(record, state)
  return { ...item, kind: 'experience', phone: notice.phoneNumber(record.phone || customer?.phone), reviewUrl: experience.REVIEW_URL }
}

function changes(previous, next) {
  return experience.completionInvitations(previous, next).map(item => envelope(next.history.find(record => String(record.id) === item.serviceId), next))
}

function webhookPayload(item, isTest = false) {
  const words = item.client.split(/\s+/)
  return { event: 'installation.completed.experience', eventId: `whatsapp-${item.id}`, isTest, serviceId: item.serviceId,
    firstName: words[0], lastName: words.slice(1).join(' '), customerName: item.client,
    email: item.recipient, phone: item.phone, technicians: item.technicians.join(' / ') || 'Equipo técnico Pignus',
    reviewUrl: experience.REVIEW_URL, serviceType: describe(item.installationType).serviceType,
    installationDescription: describe(item.installationType).installationDescription }
}

module.exports = { ready, envelope, changes, webhookPayload }
