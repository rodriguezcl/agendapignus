const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const postgres = require('postgres')

const argumentsList = new Set(process.argv.slice(2))
const replace = argumentsList.has('--replace')
const dryRun = argumentsList.has('--dry-run')
const confirmed = argumentsList.has('--confirm')
const databasePathArgument = process.argv.find(argument => argument.startsWith('--database='))
const databasePath = path.resolve(databasePathArgument ? databasePathArgument.slice('--database='.length) : path.join(__dirname, '..', 'data', 'agenda-tecnica.db'))

if (!process.env.DATABASE_URL && !dryRun) {
  console.error('Falta DATABASE_URL. Usá la conexión Transaction pooler de Supabase.')
  process.exit(1)
}

if (!dryRun && !confirmed) {
  console.error('Migración cancelada. Para autorizar una escritura remota repetí el comando con --confirm.')
  process.exit(1)
}

const source = new DatabaseSync(databasePath, { readOnly: true })
const readJsonRows = (table, key = 'id') => source.prepare(`SELECT ${key}, data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data))
const preferences = source.prepare('SELECT key, value FROM preferences').all()
const payload = {
  roles: readJsonRows('roles'),
  employees: readJsonRows('employees'),
  services: readJsonRows('services'),
  customers: readJsonRows('customers', 'account'),
  history: readJsonRows('work_history'),
  agendas: readJsonRows('agendas'),
  reviews: readJsonRows('reviews'),
  audit: readJsonRows('audit_log'),
  preferences
}
source.close()

const summary = Object.fromEntries(Object.entries(payload).map(([name, records]) => [name, records.length]))
console.log(`Origen: ${databasePath}`)
console.log('Registros encontrados:', summary)

if (dryRun) {
  console.log('Validación terminada. No se escribió en Supabase.')
  process.exit(0)
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 10,
  connect_timeout: 15,
  ssl: 'require'
})

const insertJsonCollection = async (transaction, table, records, columns) => {
  if (!records.length) return
  const serializable = records.map(record => Object.fromEntries(columns.map(([column, value]) => [column, value(record)])))
  await transaction`insert into ${transaction(table)} ${transaction(serializable)}`
}

async function migrate() {
  await sql.begin(async transaction => {
    const [{ total }] = await transaction`select (
      (select count(*) from pignus_roles) +
      (select count(*) from pignus_employees) +
      (select count(*) from pignus_services) +
      (select count(*) from pignus_customers) +
      (select count(*) from pignus_work_history)
    )::integer as total`
    if (total > 0 && !replace) throw new Error('Supabase ya contiene datos. Repetí con --replace solamente si querés reemplazarlos.')

    if (replace) {
      await transaction`delete from pignus_sessions`
      await transaction`delete from pignus_login_attempts`
      await transaction`delete from pignus_audit_log`
      await transaction`delete from pignus_reviews`
      await transaction`delete from pignus_agendas`
      await transaction`delete from pignus_work_history`
      await transaction`delete from pignus_customers`
      await transaction`delete from pignus_services`
      await transaction`delete from pignus_employees`
      await transaction`delete from pignus_roles`
      await transaction`delete from pignus_preferences`
    }

    await insertJsonCollection(transaction, 'pignus_roles', payload.roles, [
      ['id', record => String(record.id)], ['data', record => transaction.json(record)]
    ])
    await insertJsonCollection(transaction, 'pignus_employees', payload.employees, [
      ['id', record => String(record.id)], ['email', record => String(record.email || '').trim().toLowerCase()], ['data', record => transaction.json(record)]
    ])
    await insertJsonCollection(transaction, 'pignus_services', payload.services, [
      ['id', record => String(record.id)], ['data', record => transaction.json(record)]
    ])
    await insertJsonCollection(transaction, 'pignus_customers', payload.customers, [
      ['account', record => String(record.account)], ['customer_id', record => String(record.customerId)], ['data', record => transaction.json(record)]
    ])
    await insertJsonCollection(transaction, 'pignus_work_history', payload.history, [
      ['id', record => String(record.id)],
      ['work_date', record => record.date || null],
      ['status', record => record.status || 'Pendiente'],
      ['service_id', record => record.serviceId == null ? null : String(record.serviceId)],
      ['customer_id', record => record.customerId == null ? null : String(record.customerId)],
      ['data', record => transaction.json(record)]
    ])
    await insertJsonCollection(transaction, 'pignus_agendas', payload.agendas, [
      ['id', record => String(record.id || 'current')], ['data', record => transaction.json(record)]
    ])
    await insertJsonCollection(transaction, 'pignus_reviews', payload.reviews, [
      ['id', record => String(record.id)], ['data', record => transaction.json(record)]
    ])
    await insertJsonCollection(transaction, 'pignus_audit_log', payload.audit, [
      ['id', record => String(record.id)], ['occurred_at', record => record.at || new Date().toISOString()], ['data', record => transaction.json(record)]
    ])
    if (payload.preferences.length) await transaction`insert into pignus_preferences ${transaction(payload.preferences)} on conflict (key) do update set value = excluded.value, updated_at = now()`
    await transaction`insert into pignus_preferences (key, value) values ('state_revision', '0'), ('theme', 'light') on conflict (key) do nothing`
  })
}

migrate()
  .then(() => console.log('Migración a Supabase completada correctamente.'))
  .catch(error => { console.error(`No se pudo migrar: ${error.message}`); process.exitCode = 1 })
  .finally(() => sql.end({ timeout: 5 }))
