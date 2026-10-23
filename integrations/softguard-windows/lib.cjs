'use strict'
const { parseDocument } = require('htmlparser2')
const { findAll, textContent } = require('domutils')
const { createHash } = require('node:crypto')

function fail(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable })
}
function validateReport(buffer, { expectedCount, dealer = 'PIG', previousCount = 0, maxDropFraction = 0.1 }) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) throw fail('COUNT_REQUIRED', 'No se pudo verificar el total en SoftGuard.')
  if (buffer.length > 30 * 1024 * 1024) throw fail('TOO_LARGE', 'El reporte supera 30 MB.')
  const html = buffer.toString('utf8')
  if (!/<\/html>\s*$/i.test(html)) throw fail('INCOMPLETE', 'El reporte no está completo.', true)
  const doc = parseDocument(html)
  const tables = findAll(n => n.name === 'table', doc.children)
  const table = tables.find(n => /dealer\/cuenta/i.test(textContent(n)))
  if (!table) throw fail('FORMAT', 'No se encontró la tabla Dealer/Cuenta.', true)
  const rows = findAll(n => n.name === 'tr', [table]).map(row =>
    findAll(n => n.name === 'td' || n.name === 'th', row.children).map(cell => textContent(cell).replace(/\s+/g, ' ').trim())
  ).filter(row => row.length)
  const headers = rows.shift() || []
  const index = headers.findIndex(h => h.toLowerCase() === 'dealer/cuenta')
  const nameIndex = headers.findIndex(h => h.toLowerCase() === 'nombre')
  if (index < 0 || nameIndex < 0) throw fail('COLUMNS', 'Faltan columnas obligatorias.', true)
  const accounts = new Set()
  for (const row of rows) {
    if (row.length !== headers.length || !row[nameIndex]) throw fail('ROW', 'El reporte contiene una fila incompleta.', true)
    const account = row[index].toUpperCase()
    if (!account.startsWith(`${dealer}-`) || !/^\w+-\d+$/.test(account)) throw fail('DEALER', 'El reporte incluye cuentas fuera del dealer esperado.')
    if (accounts.has(account)) throw fail('DUPLICATE', 'El reporte contiene cuentas duplicadas.')
    accounts.add(account)
  }
  if (accounts.size !== expectedCount) throw fail('COUNT_MISMATCH', 'El total del archivo no coincide con el listado de SoftGuard.', true)
  if (previousCount && accounts.size < previousCount * (1 - maxDropFraction)) throw fail('SUSPICIOUS_DROP', 'La cantidad de cuentas disminuyó más del umbral permitido; requiere revisión.')
  // Exclude volatile report headers/timestamps, but retain every imported field.
  const hash = createHash('sha256').update(JSON.stringify({ headers, rows: rows.sort((a, b) => a[index].localeCompare(b[index])) })).digest('hex')
  return { count: accounts.size, hash, bytes: buffer.length, report: { version: 1, accounts: [...accounts].sort() } }
}
async function retryDownload(operation, { attempts = 3, sleep = ms => new Promise(r => setTimeout(r, ms)), onRetry = () => {} } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(attempt) } catch (error) {
      if (!error.retryable || attempt === attempts) throw error
      onRetry(attempt, error.code)
      await sleep(attempt * 10000)
    }
  }
}
module.exports = { fail, validateReport, retryDownload }
