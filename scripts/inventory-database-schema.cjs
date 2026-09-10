const { database } = require('../api/_lib/database.cjs')

async function main() {
  if (!process.argv.slice(2).every(argument => argument === '--production-read-only')) throw new Error('Este inventario solo admite --production-read-only.')
  const sql = database()
  try {
    const result = await sql.begin(async transaction => {
      await transaction`set transaction isolation level repeatable read, read only`
      await transaction`set local statement_timeout = '20000'`
      const tables = await transaction`
        select c.relname as table_name, c.relrowsecurity as row_level_security,
          pg_total_relation_size(c.oid)::bigint as total_bytes,
          coalesce(s.n_live_tup, 0)::bigint as estimated_rows
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_stat_user_tables s on s.relid = c.oid
        where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'pignus_%'
        order by c.relname`
      const columns = await transaction`
        select table_name, ordinal_position, column_name, data_type, udt_name,
          is_nullable = 'YES' as nullable
        from information_schema.columns
        where table_schema = 'public' and table_name like 'pignus_%'
        order by table_name, ordinal_position`
      const constraints = await transaction`
        select tc.table_name, tc.constraint_name, tc.constraint_type,
          coalesce(string_agg(kcu.column_name, ',' order by kcu.ordinal_position), '') as columns
        from information_schema.table_constraints tc
        left join information_schema.key_column_usage kcu
          on kcu.constraint_schema = tc.constraint_schema and kcu.constraint_name = tc.constraint_name
        where tc.table_schema = 'public' and tc.table_name like 'pignus_%'
        group by tc.table_name, tc.constraint_name, tc.constraint_type
        order by tc.table_name, tc.constraint_type, tc.constraint_name`
      const indexes = await transaction`
        select tablename as table_name, indexname as index_name
        from pg_indexes
        where schemaname = 'public' and tablename like 'pignus_%'
        order by tablename, indexname`
      return { tables, columns, constraints, indexes }
    })
    console.log(JSON.stringify({ ...result, productionModified: false }, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: 'No se completó el inventario físico. No se aplicaron cambios a producción.', code: error.code || 'SCHEMA_INVENTORY_FAILED' }))
  process.exitCode = 1
})
