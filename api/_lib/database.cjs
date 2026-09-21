const postgres = require('postgres')

let client

function databasePoolSize(environment = process.env) {
  const configured = Number.parseInt(environment.PIGNUS_DB_POOL_MAX, 10)
  return Number.isInteger(configured) ? Math.min(10, Math.max(2, configured)) : 6
}

function vehicleCollection(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function database() {
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL.')
  // A single connection serialized polling, reads and writes from every active
  // administrator served by the same instance. Keep this pool small but concurrent.
  if (!client) client = postgres(process.env.DATABASE_URL, { max: databasePoolSize(), prepare: false, idle_timeout: 20, connect_timeout: 15, ssl: 'require' })
  return client
}

async function readState(sql) {
  // Un único viaje al Transaction Pooler evita multiplicar conexiones y
  // latencia al reconstruir el estado completo dentro de una función serverless.
  const [state] = await sql`
    select
      coalesce((select jsonb_agg(data order by created_at, id) from pignus_roles), '[]'::jsonb) as roles,
      coalesce((select jsonb_agg(data order by created_at, id) from pignus_employees), '[]'::jsonb) as employees,
      coalesce((select jsonb_agg(data order by created_at, id) from pignus_services), '[]'::jsonb) as services,
      coalesce((select jsonb_agg(data order by created_at, account) from pignus_customers), '[]'::jsonb) as customers,
      coalesce((select jsonb_agg(data order by created_at, id) from pignus_work_history), '[]'::jsonb) as history,
      (select data from pignus_agendas where id = 'current') as agenda,
      coalesce((select jsonb_agg(data order by created_at, id) from pignus_reviews), '[]'::jsonb) as reviews,
      coalesce((select jsonb_object_agg(key, value) from pignus_preferences where key in ('state_revision', 'theme', 'vehicles')), '{}'::jsonb) as preferences
  `
  return {
    revision: Number(state.preferences?.state_revision || 0),
    roles: state.roles || [],
    employees: state.employees || [],
    services: state.services || [],
    vehicles: vehicleCollection(state.preferences?.vehicles),
    customers: state.customers || [],
    history: state.history || [],
    agenda: state.agenda || null,
    reviews: state.reviews || [],
    preferences: { theme: state.preferences?.theme || 'light' }
  }
}

async function readRevision(sql) {
  const rows = await sql`select value from pignus_preferences where key = 'state_revision'`
  return Number(rows[0]?.value || 0)
}

async function readTechnicianState(sql, technicianId, today) {
  // Technicians refresh frequently from mobile devices. Return only their own
  // jobs, the customer context needed for active jobs, vehicles and revision;
  // never aggregate the administrative catalog or the complete agenda.
  const [state] = await sql`
    with active_customers as (
      select
        nullif(data->>'customerId', '') as customer_id,
        upper(coalesce(nullif(data->>'clientAccount', ''), split_part(coalesce(data->>'client', ''), ' ', 1))) as account
      from pignus_work_history
      where exists (
        select 1
        from jsonb_array_elements_text(coalesce(data->'technicianIds', '[]'::jsonb)) as assigned(technician_id)
        where assigned.technician_id = ${String(technicianId)}
      )
        and coalesce(data->>'date', '') >= ${String(today)}
        and coalesce(data->>'technicalStatus', '') = ''
        and coalesce(data->>'status', 'Pendiente') not in ('Completado', 'Avance registrado', 'Cancelado', 'Reprogramado')
    )
    select
      coalesce((
        select jsonb_agg(history.data order by history.work_date, history.created_at, history.id)
        from pignus_work_history history
        where exists (
          select 1
          from jsonb_array_elements_text(coalesce(history.data->'technicianIds', '[]'::jsonb)) as assigned(technician_id)
          where assigned.technician_id = ${String(technicianId)}
        )
          or nullif(history.data->>'customerId', '') in (select customer_id from active_customers where customer_id is not null)
          or upper(coalesce(nullif(history.data->>'clientAccount', ''), split_part(coalesce(history.data->>'client', ''), ' ', 1))) in (select account from active_customers where account <> '')
      ), '[]'::jsonb) as history,
      coalesce((select jsonb_object_agg(key, value) from pignus_preferences where key in ('state_revision', 'vehicles')), '{}'::jsonb) as preferences
  `
  return {
    revision: Number(state.preferences?.state_revision || 0),
    roles: [], employees: [], services: [], customers: [], reviews: [], agenda: null,
    history: state.history || [],
    vehicles: vehicleCollection(state.preferences?.vehicles),
    preferences: {}
  }
}

async function readCustomers(sql) {
  const rows = await sql`select data from pignus_customers order by created_at, account`
  return rows.map(row => row.data)
}

async function readExportState(sql) {
  // Los reportes solamente necesitan estas dos colecciones. Evita descargar
  // clientes, agenda, empleados y preferencias antes de generar cada archivo.
  const [state] = await sql`
    select
      coalesce((select jsonb_agg(data order by created_at, id) from pignus_services where data is not null), '[]'::jsonb) as services,
      coalesce((select jsonb_agg(data order by work_date desc, created_at, id) from pignus_work_history where data is not null), '[]'::jsonb) as history
  `
  return { services: state?.services || [], history: state?.history || [] }
}

async function replaceCollections(sql, state, previous = null) {
  const changed = key => !previous || JSON.stringify(previous[key]) !== JSON.stringify(state[key])
  if (changed('roles')) {
  await sql`delete from pignus_roles`
  if (state.roles.length) await sql`insert into pignus_roles ${sql(state.roles.map(record => ({ id: String(record.id), data: sql.json(record) })))}`
  }

  if (changed('employees')) {
  await sql`delete from pignus_employees`
  if (state.employees.length) await sql`insert into pignus_employees ${sql(state.employees.map(record => ({ id: String(record.id), email: String(record.email).trim().toLowerCase(), data: sql.json(record) })))}`
  }

  if (changed('services')) {
  await sql`delete from pignus_services`
  if (state.services.length) await sql`insert into pignus_services ${sql(state.services.map(record => ({ id: String(record.id), data: sql.json(record) })))}`
  }

  if (changed('vehicles')) await sql`insert into pignus_preferences (key, value, updated_at) values ('vehicles', ${JSON.stringify(state.vehicles || [])}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`

  if (changed('customers')) {
  await sql`delete from pignus_customers`
  if (state.customers.length) await sql`insert into pignus_customers ${sql(state.customers.map(record => ({ account: String(record.account), customer_id: String(record.customerId), data: sql.json(record) })))}`
  }

  const { recordChanges } = require('./record-changes.cjs')
  // With a baseline, only explicit removed IDs can produce DELETEs. All
  // remaining records keep their physical rows and concurrent metadata.
  if (!previous) await sql`delete from pignus_work_history`
  const historyDelta = recordChanges(previous?.history, state.history)
  if (historyDelta.removed.length) await sql`delete from pignus_work_history where id in ${sql(historyDelta.removed)}`
  if (historyDelta.changed.length) await sql`insert into pignus_work_history ${sql(historyDelta.changed.map(record => ({ id: String(record.id), work_date: record.date || null, status: record.status || 'Pendiente', service_id: record.serviceId == null ? null : String(record.serviceId), customer_id: record.customerId == null ? null : String(record.customerId), data: sql.json(record) })))} on conflict (id) do update set work_date = excluded.work_date, status = excluded.status, service_id = excluded.service_id, customer_id = excluded.customer_id, data = excluded.data`
  if (!previous || historyDelta.removed.length || changed('vehicles')) {
  await sql`create table if not exists pignus_vehicle_control_photos (record_id text primary key, vehicle_id text not null, mime_type text not null, photo_data bytea not null, created_at timestamptz not null default now())`
  await sql`alter table pignus_vehicle_control_photos enable row level security`
  await sql`revoke all on table pignus_vehicle_control_photos from anon, authenticated`
  await sql`create table if not exists pignus_service_photos (record_id text primary key references pignus_work_history(id) on delete cascade, mime_type text not null, photo_data bytea not null, created_at timestamptz not null default now(), uploaded_by_id text, uploaded_by_name text)`
  await sql`alter table pignus_service_photos enable row level security`
  await sql`revoke all on table pignus_service_photos from anon, authenticated`
  await sql`delete from pignus_service_photos where not exists (select 1 from pignus_work_history where pignus_work_history.id = pignus_service_photos.record_id)`
  await sql`delete from pignus_vehicle_control_photos where not exists (select 1 from pignus_work_history where pignus_work_history.id = pignus_vehicle_control_photos.record_id)`
  await sql`create table if not exists pignus_vehicle_insurance_documents (vehicle_id text primary key, file_name text not null, pdf_data bytea not null, uploaded_at timestamptz not null default now())`
  await sql`alter table pignus_vehicle_insurance_documents enable row level security`
  await sql`revoke all on table pignus_vehicle_insurance_documents from anon, authenticated`
  }

  if (changed('reviews')) {
  await sql`delete from pignus_reviews`
  if (state.reviews.length) await sql`insert into pignus_reviews ${sql(state.reviews.map(record => ({ id: String(record.id), data: sql.json(record) })))}`
  }

  if (changed('agenda')) await sql`insert into pignus_agendas (id, data, updated_at) values ('current', ${sql.json(state.agenda || {})}, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`
  if (changed('preferences')) await sql`insert into pignus_preferences (key, value, updated_at) values ('theme', ${state.preferences?.theme || 'light'}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`
}

async function appendAudit(sql, entries) {
  if (!entries.length) return
  await sql`insert into pignus_audit_log ${sql(entries.map(entry => ({ id: entry.id, occurred_at: entry.at, data: sql.json(entry) })))}`
  await sql`delete from pignus_audit_log where id in (select id from pignus_audit_log order by occurred_at desc offset 100)`
}

module.exports = { appendAudit, database, databasePoolSize, readCustomers, readExportState, readRevision, readState, readTechnicianState, replaceCollections }
