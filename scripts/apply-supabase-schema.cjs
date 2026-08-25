const fs = require('node:fs')
const path = require('node:path')
const postgres = require('postgres')

if (!process.argv.includes('--confirm')) {
  console.error('Aplicación de esquema cancelada. Para autorizar una escritura remota repetí el comando con --confirm.')
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Configurala en .env.local con la URI Transaction pooler de Supabase.')
  process.exit(1)
}

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '202608250001_pignus_schema.sql')
const migration = fs.readFileSync(migrationPath, 'utf8')
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 10,
  connect_timeout: 15,
  ssl: 'require'
})

async function applySchema() {
  await sql.unsafe(migration)
  const tables = await sql`
    select count(*)::integer as total
    from information_schema.tables
    where table_schema = 'public' and table_name like 'pignus_%'
  `
  if (tables[0]?.total !== 11) throw new Error(`Se esperaban 11 tablas pignus_* y se encontraron ${tables[0]?.total ?? 0}.`)
}

applySchema()
  .then(() => console.log('Esquema Supabase aplicado y verificado correctamente.'))
  .catch(error => { console.error(`No se pudo aplicar el esquema: ${error.message}`); process.exitCode = 1 })
  .finally(() => sql.end({ timeout: 5 }))
