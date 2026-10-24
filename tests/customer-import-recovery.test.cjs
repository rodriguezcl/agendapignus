const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const recovery = require('../api/_lib/customer-import-recovery.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

test('PostgreSQL: receipt is atomic; resolve seals late requests and cannot cross users', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec('create role anon; create role authenticated; create table business (id int primary key, revision int); insert into business values (1,0);')
    const sql = pgliteAdapter(pg), user = { id: 'importer' }
    await recovery.ensure(sql)
    const body = { operationId: randomUUID(), revision: 0, customers: [{ account: 'PIG-1' }], responseMode: 'compact-v1' }
    const apply = (input, rollback = false, actor = user) => sql.begin(async tx => {
      const [row] = await tx`select revision from business where id=1 for update`
      const replay = await recovery.prepare(tx, actor, input)
      if (replay) return replay
      await tx`update business set revision=revision+1 where id=1`
      const result = await recovery.complete(tx, actor, input, { revision: row.revision + 1, customerCount: 1 })
      if (rollback) throw Error('connection aborted before commit')
      return result
    })
    await assert.rejects(apply(body, true), /before commit/)
    assert.equal((await sql`select * from pignus_customer_import_operations`).length, 0)
    assert.equal((await sql`select revision from business`)[0].revision, 0)
    const receipt = await apply(body)
    assert.deepEqual(await apply(body), receipt)
    assert.deepEqual(await apply({ operationId: body.operationId, resolveOperation: true }), receipt)
    assert.equal((await sql`select revision from business`)[0].revision, 1)
    await assert.rejects(apply({ ...body, revision: 3 }), { statusCode: 409 })
    await assert.rejects(apply({ operationId: body.operationId, resolveOperation: true }, false, { id: 'other' }), { statusCode: 403 })
    const late = { ...body, operationId: randomUUID() }
    assert.equal((await apply({ operationId: late.operationId, resolveOperation: true })).operationStatus, 'aborted')
    await assert.rejects(apply(late), { statusCode: 409 })
    assert.equal((await sql`select revision from business`)[0].revision, 1)
    await assert.rejects(apply({ operationId: 'invalid', resolveOperation: true }), { statusCode: 400 })
    await pg.exec('set role anon')
    await assert.rejects(pg.query('select * from pignus_customer_import_operations'), /permission denied/)
    await pg.exec('reset role')
  } finally { await pg.close() }
})
