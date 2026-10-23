const clean = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR')
function automaticSubject({ customer, event, category, subcategory, requesterName } = {}) {
  const account = clean(customer?.account), rawName = clean(customer?.name)
  const name = account && rawName.startsWith(account + ' ') ? rawName.slice(account.length).trim() : rawName
  const identity = [account, name].filter(Boolean).join(' ') || clean(requesterName) || 'SOLICITUD INTERNA'
  const request = [clean(category?.name), clean(subcategory?.name)].filter(Boolean).join(' / ') || 'SOLICITUD'
  const eventName = clean(event?.name)
  // Reservar lugar para los tres componentes aun con nombres extensos.
  return [identity.slice(0, 75), eventName.slice(0, 35), request.slice(0, eventName ? 44 : 82)].filter(Boolean).join(' - ').slice(0, 160)
}
module.exports = { automaticSubject }
