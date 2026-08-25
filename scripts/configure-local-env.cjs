const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const envPath = path.join(__dirname, '..', '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('No existe .env.local en la raíz del proyecto.')
  process.exit(1)
}

const lines = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
const values = new Map()
for (const line of lines) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (match) values.set(match[1], match[2])
}

let databaseUrl
try { databaseUrl = new URL(values.get('DATABASE_URL') || '') }
catch { console.error('DATABASE_URL no es una URI PostgreSQL válida.'); process.exit(1) }

if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || databaseUrl.port !== '6543' || !databaseUrl.hostname.endsWith('.pooler.supabase.com')) {
  console.error('DATABASE_URL debe usar el Transaction pooler de Supabase en el puerto 6543.')
  process.exit(1)
}
databaseUrl.searchParams.set('sslmode', 'require')

const desired = new Map([
  ['DATABASE_URL', databaseUrl.toString()],
  ['PIGNUS_SESSION_SECRET', values.get('PIGNUS_SESSION_SECRET')?.length >= 32 ? values.get('PIGNUS_SESSION_SECRET') : crypto.randomBytes(48).toString('hex')],
  ['PIGNUS_RATE_LIMIT_SECRET', values.get('PIGNUS_RATE_LIMIT_SECRET')?.length >= 32 ? values.get('PIGNUS_RATE_LIMIT_SECRET') : crypto.randomBytes(48).toString('hex')]
])

const written = new Set()
const nextLines = lines.filter((line, index) => line || index < lines.length - 1).map(line => {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
  if (!match || !desired.has(match[1])) return line
  written.add(match[1])
  return `${match[1]}=${desired.get(match[1])}`
})
for (const [name, value] of desired) if (!written.has(name)) nextLines.push(`${name}=${value}`)
fs.writeFileSync(envPath, `${nextLines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })

console.log('Configuración local validada: conexión TLS y dos secretos internos presentes. No se mostraron credenciales.')
