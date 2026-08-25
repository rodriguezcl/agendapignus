const postgres = require('postgres')

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en .env.local.')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 5,
  connect_timeout: 15,
  ssl: 'require'
})

async function checkConnection() {
  const connection = await sql`select current_database() as database, current_user as role`
  const tables = await sql`
    select count(*)::integer as total,
      count(*) filter (where rowsecurity)::integer as rls_enabled
    from pg_tables
    where schemaname = 'public' and tablename like 'pignus_%'
  `
  let records = null

  if (tables[0]?.total === 11) {
    const [counts] = await sql`
      select
        (select count(*)::integer from pignus_roles) as roles,
        (select count(*)::integer from pignus_employees) as employees,
        (select count(*)::integer from pignus_services) as services,
        (select count(*)::integer from pignus_customers) as customers,
        (select count(*)::integer from pignus_work_history) as history,
        (select count(*)::integer from pignus_agendas) as agendas,
        (select count(*)::integer from pignus_reviews) as reviews,
        (select count(*)::integer from pignus_audit_log) as audit,
        (select count(*)::integer from pignus_preferences) as preferences,
        (select count(*)::integer from pignus_sessions) as sessions,
        (select count(*)::integer from pignus_login_attempts) as login_attempts
    `
    records = counts
  }

  console.log(JSON.stringify({
    connected: connection[0]?.database === 'postgres',
    pignusTables: tables[0]?.total || 0,
    pignusTablesWithRls: tables[0]?.rls_enabled || 0,
    records
  }))
}

checkConnection()
  .catch(error => { console.error(`No se pudo validar la conexión: ${error.message}`); process.exitCode = 1 })
  .finally(() => sql.end({ timeout: 5 }))
