const { storageMode } = require('./storage-router.cjs')

async function queryRows(sql, statement, parameters = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, parameters) : await sql.unsafe(statement, parameters)
  return result.rows || result
}

function historyFilter(column) {
  return `${column}->>'status' = 'Completado'
    and left(coalesce(${column}->>'date', ''), length($1::text)) = $1::text
    and ($2::text is null or exists (
      select 1 from jsonb_array_elements_text(case when jsonb_typeof(${column}->'technicianIds') = 'array'
        then ${column}->'technicianIds' else '[]'::jsonb end) as assigned(id)
      where assigned.id = $2::text
    ))`
}

async function readApplicationExportState(sql, { month, technicianId = null, environment } = {}) {
  const parameters = [String(month || ''), technicianId == null ? null : String(technicianId)]
  let hasShadow = false
  if (storageMode(environment) === 'persistent') {
    const [catalog] = await queryRows(sql, "select to_regclass('normalized_shadow.import_batch') as batch_table, to_regclass('normalized_shadow.storage_control') as control_table")
    hasShadow = Boolean(catalog?.batch_table && catalog.control_table)
  }
  const legacyServices = "coalesce((select jsonb_agg(data order by created_at, id) from pignus_services), '[]'::jsonb)"
  const legacyHistory = `coalesce((select jsonb_agg(data order by created_at, id) from pignus_work_history where ${historyFilter('data')}), '[]'::jsonb)`
  if (!hasShadow) {
    const [state] = await queryRows(sql, `select ${legacyServices} as services, ${legacyHistory} as history`, parameters)
    return { services: state?.services || [], history: state?.history || [] }
  }
  // Selector, revision and selected rows belong to one PostgreSQL snapshot.
  // CASE avoids evaluating the inactive model's payload subqueries.
  const [state] = await queryRows(sql, `with selection as (
    select (select source_revision from normalized_shadow.import_batch where id=1) as source_revision,
      (select active_model from normalized_shadow.storage_control where id=1) as model,
      (select active_revision from normalized_shadow.storage_control where id=1) as revision
  )
  select model, revision, source_revision,
    case when source_revision is not null and model='normalized' then
      coalesce((select jsonb_agg(original_payload order by source_position) from normalized_shadow.source_record_evidence where collection='service_types'), '[]'::jsonb)
      else ${legacyServices} end as services,
    case when source_revision is not null and model='normalized' then
      coalesce((select jsonb_agg(original_payload order by source_position) from normalized_shadow.history_evidence where ${historyFilter('original_payload')}), '[]'::jsonb)
      else ${legacyHistory} end as history
  from selection`, parameters)
  if (state.source_revision != null && !state.model) throw Object.assign(new Error('Falta el control de almacenamiento normalizado.'), { code: 'STORAGE_CONTROL_MISSING' })
  if (state.model === 'normalized' && state.source_revision != null && Number(state.revision) !== Number(state.source_revision)) {
    throw Object.assign(new Error('La revisión normalizada no coincide con el selector persistente.'), { code: 'STORAGE_CONTROL_READ_CONFLICT' })
  }
  return { services: state.services || [], history: state.history || [] }
}

module.exports = { readApplicationExportState }
