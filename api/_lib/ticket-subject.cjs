const clean = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR')
function automaticSubject({ customer, event, zone, requesterName, category, subcategory, scope } = {}) {
  const account = clean(customer?.account), rawName = clean(customer?.name)
  const name = account && rawName.startsWith(account + ' ') ? rawName.slice(account.length).trim() : rawName
  const identity = [account, name].filter(Boolean).join(' ') || clean(requesterName) || (scope === 'customer' ? 'SOLICITUD DE ABONADO O CLIENTE' : 'SOLICITUD INTERNA')
  const eventName = clean(event?.name), zoneText = clean(zone)
  const zoneName = zoneText && (/^ZONA\b/.test(zoneText) ? zoneText : 'ZONA ' + zoneText)
  // Reservar espacio para evento y zona aun con nombres de cuenta extensos.
  const suffix = [eventName.slice(0, 45), zoneName.slice(0, 65)].filter(Boolean)
  if (!suffix.length) {
    const request = category?.id === 'commercial' && subcategory?.id === 'quote' && subcategory.name === 'Cotizar adicional' ? 'Solicitud de cotización' : subcategory?.name || category?.name
    if (request) suffix.push(clean(request).slice(0, 100))
  }
  const identityLimit = 160 - suffix.reduce((total, part) => total + part.length + 3, 0)
  return [identity.slice(0, identityLimit), ...suffix].join(' - ')
}
module.exports = { automaticSubject }
