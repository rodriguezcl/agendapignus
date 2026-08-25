const postgres = require('postgres')

let client

function database() {
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL.')
  if (!client) client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 15, ssl: 'require' })
  return client
}

async function readState(sql) {
  // Transaction Pooler multiplexa una conexión serverless. Encolar todas estas
  // lecturas con Promise.all puede dejar consultas esperando otra conexión del
  // mismo proceso hasta agotar el tiempo de ejecución de Vercel.
  const roles = await sql`select data from pignus_roles order by created_at, id`
  const employees = await sql`select data from pignus_employees order by created_at, id`
  const services = await sql`select data from pignus_services order by created_at, id`
  const customers = await sql`select data from pignus_customers order by created_at, account`
  const history = await sql`select data from pignus_work_history order by created_at, id`
  const agendas = await sql`select id, data from pignus_agendas where id = 'current'`
  const reviews = await sql`select data from pignus_reviews order by created_at, id`
  const preferences = await sql`select key, value from pignus_preferences where key in ('state_revision', 'theme')`
  const preferenceMap = Object.fromEntries(preferences.map(item => [item.key, item.value]))
  return {
    revision: Number(preferenceMap.state_revision || 0),
    roles: roles.map(row => row.data),
    employees: employees.map(row => row.data),
    services: services.map(row => row.data),
    customers: customers.map(row => row.data),
    history: history.map(row => row.data),
    agenda: agendas[0]?.data || null,
    reviews: reviews.map(row => row.data),
    preferences: { theme: preferenceMap.theme || 'light' }
  }
}

async function replaceCollections(sql, state) {
  await sql`delete from pignus_roles`
  if (state.roles.length) await sql`insert into pignus_roles ${sql(state.roles.map(record => ({ id: String(record.id), data: sql.json(record) })))}`

  await sql`delete from pignus_employees`
  if (state.employees.length) await sql`insert into pignus_employees ${sql(state.employees.map(record => ({ id: String(record.id), email: String(record.email).trim().toLowerCase(), data: sql.json(record) })))}`

  await sql`delete from pignus_services`
  if (state.services.length) await sql`insert into pignus_services ${sql(state.services.map(record => ({ id: String(record.id), data: sql.json(record) })))}`

  await sql`delete from pignus_customers`
  if (state.customers.length) await sql`insert into pignus_customers ${sql(state.customers.map(record => ({ account: String(record.account), customer_id: String(record.customerId), data: sql.json(record) })))}`

  await sql`delete from pignus_work_history`
  if (state.history.length) await sql`insert into pignus_work_history ${sql(state.history.map(record => ({ id: String(record.id), work_date: record.date || null, status: record.status || 'Pendiente', service_id: record.serviceId == null ? null : String(record.serviceId), customer_id: record.customerId == null ? null : String(record.customerId), data: sql.json(record) })))}`

  await sql`delete from pignus_reviews`
  if (state.reviews.length) await sql`insert into pignus_reviews ${sql(state.reviews.map(record => ({ id: String(record.id), data: sql.json(record) })))}`

  await sql`insert into pignus_agendas (id, data, updated_at) values ('current', ${sql.json(state.agenda || {})}, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`
  await sql`insert into pignus_preferences (key, value, updated_at) values ('theme', ${state.preferences?.theme || 'light'}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`
}

async function appendAudit(sql, entries) {
  if (!entries.length) return
  await sql`insert into pignus_audit_log ${sql(entries.map(entry => ({ id: entry.id, occurred_at: entry.at, data: sql.json(entry) })))}`
  await sql`delete from pignus_audit_log where id in (select id from pignus_audit_log order by occurred_at desc offset 100)`
}

module.exports = { appendAudit, database, readState, replaceCollections }
