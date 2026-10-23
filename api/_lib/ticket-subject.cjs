const clean = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR')
function automaticSubject({ customer, event, zone, requesterName } = {}) {
  const account = clean(customer?.account), rawName = clean(customer?.name)
  const name = account && rawName.startsWith(account + ' ') ? rawName.slice(account.length).trim() : rawName
  const identity = [account, name].filter(Boolean).join(' ') || clean(requesterName) || 'SOLICITUD INTERNA'
  const eventName = clean(event?.name), zoneText = clean(zone)
  const zoneName = zoneText && (/^ZONA\b/.test(zoneText) ? zoneText : 'ZONA ' + zoneText)
  // Reservar espacio para evento y zona aun con nombres de cuenta extensos.
  const suffix = [eventName.slice(0, 45), zoneName.slice(0, 65)].filter(Boolean)
  const identityLimit = 160 - suffix.reduce((total, part) => total + part.length + 3, 0)
  return [identity.slice(0, identityLimit), ...suffix].join(' - ')
}
module.exports = { automaticSubject }
