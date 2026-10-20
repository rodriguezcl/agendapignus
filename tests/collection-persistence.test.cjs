const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { replaceSqliteRows } = require('../api/_lib/sqlite-collections.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

function fixture() {
  return {
    roles: [1, 2, 3].map(id => ({ id: `r${id}`, name: `Role ${id}` })),
    employees: [1, 2, 3].map(id => ({ id: `e${id}`, email: `employee${id}@example.test`, name: `Employee ${id}`, passwordHash: `private-hash-${id}` })),
    services: [1, 2, 3].map(id => ({ id: `s${id}`, name: `Service ${id}` })),
    customers: [1, 2, 3].map(id => ({ customerId: `c${id}`, account: `CLI-000${id}`, name: `Customer ${id}` })),
    history: [{ id: 'h1', date: '2026-10-01', serviceId: 's1', customerId: 'c1', status: 'Pendiente' }],
    reviews: [1, 2, 3].map(id => ({ id: `v${id}`, text: `Review ${id}` })),
    vehicles: [], agenda: { teams: [], weekly: {} }, preferences: { theme: 'light' }
  }
}

test('Postgres collection deltas preserve rows, credentials, photos and unique identifiers', async t => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  const statements = []
  const sql = pgliteAdapter(pg, statements)
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    await sql.begin(tx => replaceCollections(tx, fixture()))
    await pg.exec(`
      create table collection_writes (collection text, operation text);
      create function track_collection_write() returns trigger language plpgsql as $$
      begin
        insert into collection_writes values (TG_TABLE_NAME, TG_OP);
        return coalesce(NEW, OLD);
      end $$;
      create table employee_metadata (employee_id text references pignus_employees(id) on delete cascade, value text);
      insert into employee_metadata values ('e1', 'keep metadata');
      insert into pignus_service_photos (record_id, mime_type, photo_data) values ('h1', 'image/jpeg', decode('010203', 'hex'));
    `)
    for (const table of ['roles', 'employees', 'services', 'customers', 'reviews']) {
      await pg.exec(`update pignus_${table} set created_at = '2020-01-01T00:00:00Z'; create trigger track_write after insert or update or delete on pignus_${table} for each row execute function track_collection_write();`)
    }

    await t.test('one edited item updates one row per catalog, preserving other data', async () => {
      const before = await readState(sql)
      const next = structuredClone(before)
      for (const key of ['roles', 'employees', 'services', 'customers']) next[key][0].name += ' updated'
      next.reviews[0].text += ' updated'
      await sql.begin(tx => replaceCollections(tx, next, before))
      const writes = (await pg.query('select collection, operation from collection_writes order by collection')).rows
      assert.equal(writes.length, 5)
      assert.ok(writes.every(write => write.operation === 'UPDATE'))
      for (const table of ['roles', 'employees', 'services', 'customers', 'reviews']) {
        assert.equal((await pg.query(`select count(*)::int as total from pignus_${table} where created_at = '2020-01-01T00:00:00Z'`)).rows[0].total, 3)
      }
      assert.equal((await pg.query('select value from employee_metadata')).rows[0].value, 'keep metadata')
      assert.equal((await pg.query("select data->>'passwordHash' as hash from pignus_employees where id = 'e1'")).rows[0].hash, 'private-hash-1')
      assert.equal((await pg.query('select encode(photo_data, \'hex\') as bytes from pignus_service_photos')).rows[0].bytes, '010203')
    })

    await t.test('identical and reordered snapshots issue no writes', async () => {
      const before = await readState(sql)
      const next = structuredClone(before)
      for (const key of ['roles', 'employees', 'services', 'customers', 'reviews']) next[key].reverse()
      statements.length = 0
      await sql.begin(tx => replaceCollections(tx, next, before))
      assert.deepEqual(statements, [])
    })

    await t.test('editing the vehicle catalog does not initialize or scan attachment tables', async () => {
      const before = await readState(sql)
      const next = { ...before, vehicles: [{ id: 'car1', plate: 'AA123BB', mileage: 12000 }] }
      statements.length = 0
      await sql.begin(tx => replaceCollections(tx, next, before))
      assert.equal(statements.length, 1)
      assert.match(statements[0], /insert into pignus_preferences/)
      assert.deepEqual((await readState(sql)).vehicles, next.vehicles)
    })

    await t.test('swaps, account conversions, additions and removals retain stable identities', async () => {
      const before = await readState(sql)
      const next = structuredClone(before)
      ;[next.employees[0].email, next.employees[1].email] = [next.employees[1].email, next.employees[0].email]
      ;[next.customers[0].account, next.customers[1].account] = [next.customers[1].account, next.customers[0].account]
      next.employees[2] = { id: 'e4', email: before.employees[2].email, passwordHash: 'private-hash-4' }
      next.customers[2] = { customerId: 'c4', account: before.customers[2].account, name: 'New customer' }
      for (const key of ['roles', 'services', 'reviews']) next[key].splice(2, 1, { id: `${key}-new`, name: 'new' })
      await sql.begin(tx => replaceCollections(tx, next, before))
      const persisted = await readState(sql)
      for (const key of ['roles', 'employees', 'services', 'customers', 'reviews']) {
        const stableKey = key === 'customers' ? 'customerId' : 'id'
        assert.deepEqual([...persisted[key]].sort((a, b) => a[stableKey].localeCompare(b[stableKey])), [...next[key]].sort((a, b) => a[stableKey].localeCompare(b[stableKey])))
      }
      assert.equal((await pg.query("select count(*)::int as total from pignus_customers where customer_id in ('c1', 'c2') and created_at = '2020-01-01T00:00:00Z'")).rows[0].total, 2)
      assert.equal((await pg.query('select value from employee_metadata')).rows[0].value, 'keep metadata')
      assert.equal(persisted.history[0].customerId, 'c1')

      const converted = structuredClone(persisted)
      converted.customers.find(customer => customer.customerId === 'c1').account = 'PIG-0001'
      await sql.begin(tx => replaceCollections(tx, converted, persisted))
      assert.equal((await pg.query("select account from pignus_customers where customer_id = 'c1'")).rows[0].account, 'PIG-0001')
    })

    await t.test('a failed unique constraint rolls back temporary identifiers and all changes', async () => {
      const before = await readState(sql)
      const next = structuredClone(before)
      next.employees[0].email = next.employees[1].email
      next.roles[0].name = 'must roll back'
      await assert.rejects(sql.begin(tx => replaceCollections(tx, next, before)), { code: '23505' })
      assert.deepEqual(await readState(sql), before)
      const invalidAccounts = structuredClone(before)
      invalidAccounts.customers[0].account = invalidAccounts.customers[1].account
      await assert.rejects(sql.begin(tx => replaceCollections(tx, invalidAccounts, before)), { code: '23505' })
      assert.deepEqual(await readState(sql), before)
    })

    await t.test('without a baseline initialization retains complete replacement semantics', async () => {
      const next = fixture()
      for (const key of ['roles', 'employees', 'services', 'customers', 'reviews', 'history']) next[key] = []
      await sql.begin(tx => replaceCollections(tx, next))
      const persisted = await readState(sql)
      for (const key of ['roles', 'employees', 'services', 'customers', 'reviews', 'history']) assert.deepEqual(persisted[key], [])
      assert.equal((await pg.query('select count(*)::int as total from pignus_service_photos')).rows[0].total, 0)
    })
  } finally { await pg.close() }
})

test('SQLite catalog edits preserve rowid and attached rows; customer account swaps preserve identity', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      pragma foreign_keys = on;
      create table employees (id text primary key, data text not null);
      create table customers (account text primary key, data text not null);
      create table attachments (employee_id text references employees(id) on delete cascade, value text);
    `)
    const before = fixture()
    replaceSqliteRows(db, 'employees', before.employees, 'id')
    replaceSqliteRows(db, 'customers', before.customers, 'account', null, 'customerId')
    db.prepare('insert into attachments values (?, ?)').run('e1', 'keep')
    const rowids = db.prepare('select rowid, id from employees order by rowid').all()
    const next = structuredClone(before)
    next.employees[0].name = 'Edited'
    replaceSqliteRows(db, 'employees', next.employees, 'id', before.employees)
    assert.deepEqual(db.prepare('select rowid, id from employees order by rowid').all(), rowids)
    assert.equal(db.prepare('select value from attachments').get().value, 'keep')
    assert.equal(JSON.parse(db.prepare('select data from employees where id = ?').get('e1').data).passwordHash, 'private-hash-1')
    const customersBefore = db.prepare('select rowid, data from customers order by rowid').all()
    ;[next.customers[0].account, next.customers[1].account] = [next.customers[1].account, next.customers[0].account]
    next.customers[2] = { customerId: 'c4', account: 'CLI-0003', name: 'New customer' }
    db.exec('begin')
    replaceSqliteRows(db, 'customers', next.customers, 'account', before.customers, 'customerId')
    db.exec('commit')
    const customersAfter = db.prepare('select rowid, data from customers order by rowid').all()
    for (const index of [0, 1]) {
      assert.equal(customersAfter[index].rowid, customersBefore[index].rowid)
      assert.deepEqual(JSON.parse(customersAfter[index].data), next.customers[index])
    }
    replaceSqliteRows(db, 'employees', next.employees.slice(1), 'id')
    assert.equal(db.prepare('select count(*) as total from attachments').get().total, 0)
    assert.equal(db.prepare('select count(*) as total from employees').get().total, 2)
  } finally { db.close() }
})
