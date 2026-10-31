const { createHash } = require('node:crypto')
const { installation, installationType, describe } = require('./installation-communications.cjs')
const { emailAddress } = require('./ticket-mail.cjs')
const { customerForRecord } = require('./granular-read-policy.cjs')
const { isIntermediate } = require('./service-journeys.cjs')
const REVIEW_URL = 'https://g.page/r/CV2Ab-6e3_B5EBE/review'
const completed = record => record?.status === 'Completado' && record.technicalStatus !== 'Cancelado'
const clean = value => String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim()
const escape = value => clean(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const joinNames = names => names.length < 2 ? names[0] || 'nuestro equipo técnico' : `${names.slice(0,-1).join(', ')} y ${names.at(-1)}`
function envelope(record, state) {
  const customer = customerForRecord(record, state)
  const visits = (record.serviceJourney ? state.history.filter(item => item.serviceJourney?.id === record.serviceJourney.id && ['Completado','Avance registrado'].includes(item.status)) : [record]).sort((a,b) => (a.serviceJourney?.index || 0) - (b.serviceJourney?.index || 0))
  const names = new Map()
  const employees = new Map((state.employees || []).map(item => [String(item.id),item]))
  for (const visit of visits.flatMap(item => [...(item.reschedulingHistory || []).filter(old => old.startedAt),item])) {
    if (visit.technicianIds?.length) visit.technicianIds.forEach((id,index) => {
      const name = clean(visit.technicians?.[index] || employees.get(String(id))?.name)
      if (name) names.set(String(id),name)
    })
    else for (const name of visit.technicians || []) if (clean(name)) names.set(clean(name).toLowerCase(),clean(name))
  }
  const technicians = [...new Set([...names.values()])]
  const fields = Object.entries(customer?.fields || {}).filter(([key]) => /^(email|e-mail|correo|correo electronico)$/.test(key.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase())).map(([,value])=>value)
  const recipient = [record.formEmail, ...visits.map(item=>item.formEmail), customer?.email, ...fields].map(emailAddress).find(Boolean) || ''
  const key = `installation:${record.serviceJourney?.id || record.id}`
  return { id: createHash('sha256').update(key).digest('hex'), serviceId: String(record.id), customerId: String(customer?.customerId || record.customerId || ''), account: customer?.account || record.clientAccount || '', client: clean(customer?.name || record.clientNameAtService || record.client || 'cliente'), technicians, recipient, date: record.date, ...describe(installationType(record)) }
}
function completionInvitations(previous, next) {
  const old = new Map((previous.history || []).map(record=>[String(record.id),record]))
  return (next.history || []).filter(record => old.has(String(record.id)) && !completed(old.get(String(record.id))) && completed(record) && installation(record) && !isIntermediate(record,next.history)).map(record=>envelope(record,next))
}
function message(item) {
  const description = describe(item.installationType)
  const paragraphs = [
    `Hola, ${item.client}:`,
    `Finalizamos la instalación de ${description.installationDescription} y queremos agradecerte por confiar en Pignus para cuidar lo que más te importa.`,
    `La instalación estuvo a cargo de ${joinNames(item.technicians)}.`,
    `Nos gustaría saber cómo fue tu experiencia: ¿cómo te resultó la atención del equipo técnico? ¿Quedó clara la explicación sobre el uso de ${description.usageDescription}?`,
    'Podés responder a este correo para contarnos tu opinión, compartir una sugerencia o hacernos llegar cualquier inquietud. Queremos escucharte y seguir mejorando.',
    'También te invitamos a compartir tu experiencia en Google. Tu reseña ayuda a otras personas a conocernos.'
  ]
  return { to:item.recipient, subject:'Tu experiencia con Pignus nos importa', automatic:true,
    text:[...paragraphs,`Compartir mi experiencia en Google: ${REVIEW_URL}`,'Gracias por elegirnos.','Equipo Pignus','Guardianes por naturaleza.'].join('\n\n'),
    html:`<div style="background-color:#f4f6f9;padding:24px;font-family:Arial,sans-serif;color:#303741"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="100%" style="max-width:560px;background-color:#ffffff;border:1px solid #dce0e5"><tr><td style="padding:28px"><p style="text-align:center;background-color:#343a40;color:#ffffff;padding:16px"><img src="https://agenda.pignusarg.com/logo-pignus.png" width="180" alt="Pignus"></p>${paragraphs.map(p=>`<p style="font-size:16px;line-height:1.6">${escape(p)}</p>`).join('')}<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background-color:#956600;padding:14px 16px;line-height:1.5"><a href="${REVIEW_URL}" style="color:#ffffff;text-decoration:none;font-weight:bold">Compartir mi experiencia en Google</a></td></tr></table><p>Gracias por elegirnos.</p><p><strong>Equipo Pignus</strong><br>Guardianes por naturaleza.</p></td></tr></table></td></tr></table></div>` }
}
module.exports = { REVIEW_URL, completed, envelope, completionInvitations, message }
