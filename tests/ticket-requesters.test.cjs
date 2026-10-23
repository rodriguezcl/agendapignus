const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')
const { requesterIds, mergeRequesterIds, sourceTicketIds, backfillMergedRequesters } = require('../api/_lib/ticket-requesters.cjs')

test('Solicitantes: conserva autores de fusiones sin convertir comentarios o asignaciones en autoría', () => {
  const source = { createdById: 'tecnico-a', requesterId: 'solicitante-a', mergedRequesterIds: ['anterior', 'tecnico-a'], participantIds: ['otro-tecnico'], assigneeId: 'encargado' }
  const target = { createdById: 'tecnico-b', requesterId: 'tecnico-b', mergedRequesterIds: ['anterior'] }
  assert.deepEqual(requesterIds(source), ['tecnico-a', 'solicitante-a', 'anterior'])
  assert.deepEqual(mergeRequesterIds(target, source), ['tecnico-b', 'anterior', 'tecnico-a', 'solicitante-a'])
  assert.deepEqual(requesterIds({ createdById: 42, requesterId: '', mergedRequesterIds: [42, null, {}, false, NaN, 'persona'] }), ['42', 'persona'])
  assert.deepEqual(requesterIds({ mergedRequesterIds: 'persona' }), [])
  assert.deepEqual(requesterIds(null), [])
  assert.deepEqual(sourceTicketIds({ id: 'principal', mergedTicketIds: ['original', 'principal'], serviceIds: ['no-es-un-ticket'] }), ['principal', 'original'])
  assert.deepEqual(sourceTicketIds(null), [])
})

async function fixture(engine) {
  const statements = [], pg = engine === 'postgres'
  let query, close, transaction
  const schema = 'CREATE TABLE pignus_tickets (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL)'
  if (pg) {
    const { PGlite } = await import('@electric-sql/pglite'), database = await PGlite.create()
    await database.exec(schema)
    query = async (statement, args = []) => { statements.push(statement); return (await database.query(sqlParameters(statement), args)).rows }
    transaction = async action => {
      await database.exec('BEGIN')
      try { const result = await action(); await database.exec('COMMIT'); return result }
      catch (error) { await database.exec('ROLLBACK'); throw error }
    }
    close = () => database.close()
  } else {
    const database = new DatabaseSync(':memory:')
    database.exec(schema)
    query = async (statement, args = []) => { statements.push(statement); const prepared = database.prepare(statement); if (/^SELECT/.test(statement)) return prepared.all(...args); prepared.run(...args); return [] }
    transaction = async action => {
      database.exec('BEGIN IMMEDIATE')
      try { const result = await action(); database.exec('COMMIT'); return result }
      catch (error) { database.exec('ROLLBACK'); throw error }
    }
    close = () => database.close()
  }
  const seed = async items => {
    for (const item of items) await query('INSERT INTO pignus_tickets (id,status,updated_at,search_text,data) VALUES (?,?,?,?,?)', [item.id, item.status, 'fecha-original', 'busqueda-original', JSON.stringify({ version: 7, updatedAt: 'fecha-original', entries: ['mensaje'], ...item })])
  }
  const rows = () => query('SELECT id,status,updated_at,search_text,data FROM pignus_tickets ORDER BY id')
  return { pg, query, close, transaction, seed, rows, statements }
}

for (const engine of ['sqlite', 'postgres']) {
  test(`Solicitantes ${engine}: reconstruye cadenas y múltiples orígenes sin conceder acceso por ciclos`, async () => {
    const f = await fixture(engine)
    try {
      await f.seed([
        { id: 'a', status: 'Fusionado', mergedIntoId: 'b', createdById: 'tecnico-a', requesterId: 'solicitante-a', participantIds: ['comentarista'], mergedRequesterIds: ['no-acredita-autoria'] },
        { id: 'b', status: 'Fusionado', mergedIntoId: 'principal', createdById: 'tecnico-b', requesterId: 'tecnico-a' },
        { id: 'c', status: 'Fusionado', mergedIntoId: 'principal', createdById: 'tecnico-c', assigneeId: 'responsable' },
        { id: 'principal', status: 'En gestión', createdById: 'creador', requesterId: 'cliente', mergedRequesterIds: ['autoria-ya-registrada'], mergedTicketIds: ['alias-ya-registrado'], title: 'Caso vigente', custom: { conservar: true } },
        { id: 'ciclo-a', status: 'Fusionado', mergedIntoId: 'ciclo-b', createdById: 'autor-ciclo-a' },
        { id: 'ciclo-b', status: 'Fusionado', mergedIntoId: 'ciclo-a', createdById: 'autor-ciclo-b' },
        { id: 'hacia-ciclo', status: 'Fusionado', mergedIntoId: 'ciclo-a', createdById: 'autor-hacia-ciclo' },
        { id: 'sin-destino', status: 'Fusionado', mergedIntoId: 'inexistente', createdById: 'autor-sin-destino' },
        { id: 'sin-referencia', status: 'Fusionado', createdById: 'autor-sin-referencia' },
        { id: 'propio-ciclo', status: 'Fusionado', mergedIntoId: 'propio-ciclo', createdById: 'autor-propio-ciclo' },
        { id: 'independiente', status: 'Nuevo', createdById: 'otro' }
      ])
      const before = await f.rows()
      f.statements.length = 0
      assert.deepEqual(await f.transaction(() => backfillMergedRequesters(f.query, { pg: f.pg })), { updated: 1 })
      if (f.pg) {
        const lockIndex = f.statements.findIndex(statement => /ORDER BY id FOR UPDATE$/.test(statement))
        assert.ok(lockIndex >= 0)
        assert.ok(f.statements.findIndex(statement => statement.startsWith('UPDATE')) > lockIndex)
      }
      const after = await f.rows()
      for (let index = 0; index < before.length; index++) {
        if (before[index].id !== 'principal') { assert.deepEqual(after[index], before[index]); continue }
        const ticket = JSON.parse(after[index].data)
        assert.deepEqual(ticket.mergedRequesterIds, ['creador', 'cliente', 'autoria-ya-registrada', 'tecnico-a', 'solicitante-a', 'tecnico-b', 'tecnico-c'])
        assert.deepEqual(ticket.mergedTicketIds, ['principal', 'alias-ya-registrado', 'a', 'b', 'c'])
        const original = JSON.parse(before[index].data)
        assert.deepEqual({ ...ticket, mergedRequesterIds: original.mergedRequesterIds, mergedTicketIds: original.mergedTicketIds }, original)
        assert.deepEqual({ ...after[index], data: before[index].data }, { ...before[index] })
      }
      assert.deepEqual(await f.transaction(() => backfillMergedRequesters(f.query, { pg: f.pg })), { updated: 0 })
      assert.deepEqual(await f.rows(), after)
    } finally { await f.close() }
  })

  test(`Solicitantes ${engine}: usa el estado leído bajo bloqueo y conserva la gestión más reciente`, async () => {
    const f = await fixture(engine)
    try {
      await f.seed([
        { id: 'origen', status: 'Fusionado', mergedIntoId: 'anterior', createdById: 'tecnico' },
        { id: 'anterior', status: 'Nuevo', createdById: 'anterior-autor' },
        { id: 'vigente', status: 'En gestión', createdById: 'vigente-autor', title: 'Anterior a la lectura' }
      ])
      const wrapped = async (statement, args) => {
        if (statement.startsWith('SELECT id,status,data')) {
          await f.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify({ id: 'origen', status: 'Fusionado', mergedIntoId: 'vigente', createdById: 'tecnico', version: 8 }), 'origen'])
          await f.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify({ id: 'vigente', status: 'En gestión', createdById: 'vigente-autor', title: 'Gestión más reciente', version: 20 }), 'vigente'])
        }
        return f.query(statement, args)
      }
      assert.deepEqual(await f.transaction(() => backfillMergedRequesters(wrapped, { pg: f.pg })), { updated: 1 })
      const rows = await f.rows(), current = JSON.parse(rows.find(row => row.id === 'vigente').data)
      assert.equal(current.title, 'Gestión más reciente')
      assert.equal(current.version, 20)
      assert.deepEqual(current.mergedRequesterIds, ['vigente-autor', 'tecnico'])
      assert.deepEqual(current.mergedTicketIds, ['vigente', 'origen'])
      assert.equal(JSON.parse(rows.find(row => row.id === 'anterior').data).mergedRequesterIds, undefined)
    } finally { await f.close() }
  })

  test(`Solicitantes ${engine}: la transacción revierte una reconstrucción incompleta`, async () => {
    const f = await fixture(engine)
    try {
      await f.seed([
        { id: 'a', status: 'Fusionado', mergedIntoId: 'destino-a', createdById: 'tecnico-a' },
        { id: 'b', status: 'Fusionado', mergedIntoId: 'destino-b', createdById: 'tecnico-b' },
        { id: 'destino-a', status: 'Nuevo', createdById: 'autor-a' },
        { id: 'destino-b', status: 'Nuevo', createdById: 'autor-b' }
      ])
      const before = await f.rows()
      let updates = 0
      const wrapped = (statement, args) => {
        if (statement.startsWith('UPDATE') && ++updates === 2) throw new Error('Interrupción simulada')
        return f.query(statement, args)
      }
      await assert.rejects(f.transaction(() => backfillMergedRequesters(wrapped, { pg: f.pg })), /Interrupción simulada/)
      assert.deepEqual(await f.rows(), before)
    } finally { await f.close() }
  })
}

test('Solicitantes: sin tickets fusionados no bloquea ni modifica filas', async () => {
  const statements = []
  assert.deepEqual(await backfillMergedRequesters(async statement => { statements.push(statement); return [] }, { pg: true }), { updated: 0 })
  assert.equal(statements.length, 1)
  assert.doesNotMatch(statements[0], /FOR UPDATE|UPDATE pignus_tickets/)
})
