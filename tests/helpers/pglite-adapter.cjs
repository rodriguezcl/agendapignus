// Execute the postgres.js tagged templates against an isolated PostgreSQL engine.
function pgliteAdapter(pg, statements = []) {
  const sql = (strings, ...values) => {
    if (!strings?.raw) return { records: strings }
    let query = strings[0]
    const params = []
    const parameter = value => {
      params.push(value?.jsonValue === undefined ? value : JSON.stringify(value.jsonValue))
      return `$${params.length}`
    }
    values.forEach((value, index) => {
      if (value?.records) {
        const records = value.records
        if (records.length && typeof records[0] === 'object') {
          const columns = Object.keys(records[0])
          query += `(${columns.map(key => `"${key}"`).join(',')}) values ` + records.map(row => `(${columns.map(key => parameter(row[key])).join(',')})`).join(',')
        } else query += `(${records.map(parameter).join(',')})`
      } else query += parameter(value)
      query += strings[index + 1]
    })
    statements.push(query)
    return pg.query(query, params).then(result => result.rows)
  }
  sql.json = value => ({ jsonValue: value })
  sql.query = (query, params) => { statements.push(query); return pg.query(query, params) }
  sql.unsafe = (query, params) => sql.query(query, params).then(result => result.rows)
  sql.begin = async callback => {
    await pg.exec('begin')
    try { const result = await callback(sql); await pg.exec('commit'); return result }
    catch (error) { await pg.exec('rollback'); throw error }
  }
  return sql
}

module.exports = { pgliteAdapter }
