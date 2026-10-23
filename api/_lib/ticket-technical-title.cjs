const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const key = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function technicalTicketTitle(ticket) {
  if (ticket.origin !== 'technical') return ticket.title
  const account = clean(ticket.customerSnapshot?.account)
  let name = clean(ticket.customerSnapshot?.name)
  if (account && key(name).startsWith(key(account) + ' ')) name = name.slice(account.length).trim()
  const identity = [account, name].filter(Boolean).join(' ')
  const title = clean(ticket.title)
  if (!identity || key(title).startsWith(key(identity)) || account && key(title).startsWith(key(account) + ' ')) return ticket.title
  return [identity, title].filter(Boolean).join(' — ')
}

module.exports = { technicalTicketTitle }
