const { lookup: dnsLookup } = require('node:dns/promises')
const { isIP } = require('node:net')
const { domainToASCII } = require('node:url')

const networkError = (message, code = 'MAIL_HOST_INVALID') => Object.assign(new Error(message), { code, statusCode: 400 })

function normalizeMailHost(value) {
  const original = String(value || '').trim().toLowerCase()
  const host = domainToASCII(original)
  if (!host || host.length > 253 || isIP(host) || !host.includes('.') || host.endsWith('.') || /[\s/@:#?\\\[\]]/.test(host) || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw networkError('Ingresá el nombre público del servidor de correo, sin protocolo ni puerto.')
  }
  if (/(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/.test(host)) throw networkError('El servidor de correo debe ser un dominio público.')
  return host
}

function isPublicMailAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113))
  }
  if (family === 6) {
    // Sólo unicast global. Se excluyen traducción, túneles, documentación y bloques especiales.
    const expanded = expandIpv6(address)
    const [a, b] = expanded
    return a >= 0x2000 && a <= 0x3fff && !(a === 0x2001 && (b <= 0x01ff || b === 0x0db8)) && a !== 0x2002 && !(a === 0x3fff && b <= 0x0fff)
  }
  return false
}

function expandIpv6(address) {
  const sides = address.toLowerCase().split('::'), left = sides[0] ? sides[0].split(':') : [], right = sides[1] ? sides[1].split(':') : []
  return [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right].map(value => Number.parseInt(value, 16))
}

function validateMailPort(protocol, port) {
  const value = Number(port)
  if (!Number.isInteger(value) || !({ imap: [993, 143], smtp: [465, 587] }[protocol] || []).includes(value)) {
    throw networkError('Usá los puertos seguros de correo: IMAP 993/143 o SMTP 465/587.', 'MAIL_PORT_INVALID')
  }
  return value
}

async function resolveMailEndpoint(protocol, value, port, { lookup = dnsLookup } = {}) {
  const servername = normalizeMailHost(value), validPort = validateMailPort(protocol, port)
  let records, timer
  try {
    records = await Promise.race([
      lookup(servername, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(networkError('Se agotó el tiempo de resolución del servidor.', 'MAIL_DNS_TIMEOUT')), 5000); timer.unref?.() })
    ])
  } catch (failure) {
    if (failure?.code === 'MAIL_DNS_TIMEOUT') throw failure
    throw networkError('No se pudo resolver el servidor de correo.', 'MAIL_DNS_FAILED')
  } finally { clearTimeout(timer) }
  if (!Array.isArray(records) || !records.length || records.some(item => !isPublicMailAddress(item.address) || isIP(item.address) !== Number(item.family))) {
    throw networkError('El servidor de correo no puede dirigir a redes privadas o reservadas.', 'MAIL_HOST_FORBIDDEN')
  }
  const selected = records.find(item => Number(item.family) === 4) || records[0]
  // Fijar la IP verificada evita una segunda resolución (DNS rebinding). El certificado se valida contra servername.
  const pinnedLookup = (_hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {} }
    if (options?.all) callback(null, [{ address: selected.address, family: Number(selected.family) }])
    else callback(null, selected.address, Number(selected.family))
  }
  return { host: selected.address, servername, port: validPort, family: Number(selected.family), lookup: pinnedLookup }
}

module.exports = { normalizeMailHost, validateMailPort, isPublicMailAddress, resolveMailEndpoint }
