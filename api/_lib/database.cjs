const postgres = require('postgres')

let client

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
  if (!client) client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 15, ssl: 'require' })
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

async function readSoftguardSubscribers(sql, { search = '', limit = 50, offset = 0 } = {}) {
  const normalizedSearch = String(search || '').trim().slice(0, 100)
  const requestedLimit = Number(limit)
  const requestedOffset = Number(offset)
  const safeLimit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
  const safeOffset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 1_000_000) : 0
  const pattern = `%${normalizedSearch}%`
  const records = await sql`
    select
      subscriber.id_interno as "idInterno",
      subscriber.numero_abonado as "numeroAbonado",
      subscriber.nombre_abonado as "nombreAbonado",
      subscriber.direccion,
      subscriber.localidad,
      subscriber.primer_contacto as "primerContacto",
      subscriber.telefono_primer_contacto as "telefonoPrimerContacto",
      subscriber.codigo_tipo_servicio as "codigoTipoServicio",
      service_type.tipo_servicio as "tipoServicio",
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'idInternoZona', zone.id_interno_zona,
            'codigoZona', zone.codigo_zona,
            'descripcionZona', zone.descripcion_zona
          ) order by zone.codigo_zona, zone.id_interno_zona
        ) filter (where zone.id_interno_zona is not null),
        '[]'::jsonb
      ) as zonas
    from softguard_abonados subscriber
    left join softguard_tipos_servicio service_type
      on service_type.codigo_tipo_servicio = subscriber.codigo_tipo_servicio and service_type.is_active
    left join softguard_zonas zone
      on zone.id_interno_abonado = subscriber.id_interno and zone.is_active
    where subscriber.is_active and (
      ${normalizedSearch} = ''
      or subscriber.numero_abonado ilike ${pattern}
      or to_tsvector('simple', coalesce(subscriber.nombre_abonado, '')) @@ websearch_to_tsquery('simple', ${normalizedSearch})
      or subscriber.localidad ilike ${pattern}
    )
    group by subscriber.id_interno, service_type.tipo_servicio
    order by subscriber.numero_abonado nulls last, subscriber.nombre_abonado nulls last
    limit ${safeLimit} offset ${safeOffset}
  `
  return { records, limit: safeLimit, offset: safeOffset }
}

async function replaceCollections(sql, state) {
  await sql`delete from pignus_roles`
  if (state.roles.length) await sql`insert into pignus_roles ${sql(state.roles.map(record => ({ id: String(record.id), data: sql.json(record) })))}`

  await sql`delete from pignus_employees`
  if (state.employees.length) await sql`insert into pignus_employees ${sql(state.employees.map(record => ({ id: String(record.id), email: String(record.email).trim().toLowerCase(), data: sql.json(record) })))}`

  await sql`delete from pignus_services`
  if (state.services.length) await sql`insert into pignus_services ${sql(state.services.map(record => ({ id: String(record.id), data: sql.json(record) })))}`

  await sql`insert into pignus_preferences (key, value, updated_at) values ('vehicles', ${JSON.stringify(state.vehicles || [])}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`

  await sql`delete from pignus_customers`
  if (state.customers.length) await sql`insert into pignus_customers ${sql(state.customers.map(record => ({ account: String(record.account), customer_id: String(record.customerId), data: sql.json(record) })))}`

  await sql`delete from pignus_work_history`
  if (state.history.length) await sql`insert into pignus_work_history ${sql(state.history.map(record => ({ id: String(record.id), work_date: record.date || null, status: record.status || 'Pendiente', service_id: record.serviceId == null ? null : String(record.serviceId), customer_id: record.customerId == null ? null : String(record.customerId), data: sql.json(record) })))}`
  await sql`create table if not exists pignus_vehicle_control_photos (record_id text primary key, vehicle_id text not null, mime_type text not null, photo_data bytea not null, created_at timestamptz not null default now())`
  await sql`alter table pignus_vehicle_control_photos enable row level security`
  await sql`revoke all on table pignus_vehicle_control_photos from anon, authenticated`
  await sql`delete from pignus_vehicle_control_photos where not exists (select 1 from pignus_work_history where pignus_work_history.id = pignus_vehicle_control_photos.record_id)`

  await sql`delete from pignus_reviews`
  if (state.reviews.length) await sql`insert into pignus_reviews ${sql(state.reviews.map(record => ({ id: String(record.id), data: sql.json(record) })))}`

  await sql`insert into pignus_agendas (id, data, updated_at) values ('current', ${sql.json(state.agenda || {})}, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`
  await sql`insert into pignus_preferences (key, value, updated_at) values ('theme', ${state.preferences?.theme || 'light'}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`
}

async function appendAudit(sql, entries) {
  if (!entries.length) return
  await sql`insert into pignus_audit_log ${sql(entries.map(entry => ({ id: entry.id, occurred_at: entry.at, data: sql.json(entry) })))}`
  await sql`delete from pignus_audit_log where id in (select id from pignus_audit_log order by occurred_at desc offset 100)`
}

module.exports = { appendAudit, database, readExportState, readRevision, readSoftguardSubscribers, readState, replaceCollections }
