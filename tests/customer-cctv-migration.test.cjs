const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')

test('la migración CCTV permite insertar abonados y es repetible sin borrar marcas', async () => {
  const db = new PGlite()
  try {
    await db.exec("create schema normalized_shadow; create table normalized_shadow.customers (id text primary key, account text); insert into normalized_shadow.customers values ('old', 'PIG-0001');")
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202609150001_customer_cctv_service.sql'), 'utf8')
    await db.exec(migration)
    await db.exec("insert into normalized_shadow.customers (id, account, cctv_service) values ('new', 'PIG-0002', false); update normalized_shadow.customers set cctv_service = true where id = 'old';")
    await db.exec(migration)
    assert.deepEqual((await db.query('select id, cctv_service from normalized_shadow.customers order by id')).rows, [
      { id: 'new', cctv_service: false }, { id: 'old', cctv_service: true }
    ])
  } finally { await db.close() }
})
