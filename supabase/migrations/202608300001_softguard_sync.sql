begin;

create table if not exists public.softguard_sincronizaciones (
  sync_run_id uuid primary key,
  estado text not null check (estado in ('receiving', 'finalizing', 'completed', 'failed')),
  origen_generado_at timestamptz not null,
  abonados_esperados integer not null check (abonados_esperados >= 0),
  zonas_esperadas integer not null check (zonas_esperadas >= 0),
  tipos_servicio_esperados integer not null check (tipos_servicio_esperados >= 0),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  recibido_at timestamptz not null default now(),
  finalizado_at timestamptz,
  duracion_ms bigint,
  error_codigo text,
  error_detalle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.softguard_sync_batches (
  sync_run_id uuid not null references public.softguard_sincronizaciones(sync_run_id) on delete cascade,
  batch_id uuid not null,
  entidad text not null check (entidad in ('abonados', 'zonas', 'tipos_servicio')),
  batch_index integer not null check (batch_index >= 0),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  record_count integer not null check (record_count between 1 and 500),
  received_at timestamptz not null default now(),
  primary key (sync_run_id, batch_id),
  unique (sync_run_id, entidad, batch_index)
);

create table if not exists public.softguard_sync_stage (
  sync_run_id uuid not null references public.softguard_sincronizaciones(sync_run_id) on delete cascade,
  entidad text not null check (entidad in ('abonados', 'zonas', 'tipos_servicio')),
  record_key text not null check (length(record_key) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  batch_id uuid not null,
  received_at timestamptz not null default now(),
  primary key (sync_run_id, entidad, record_key),
  foreign key (sync_run_id, batch_id) references public.softguard_sync_batches(sync_run_id, batch_id) on delete cascade
);

create table if not exists public.softguard_sync_nonces (
  nonce uuid primary key,
  signed_at timestamptz not null,
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now()
);

create index if not exists softguard_sync_nonces_received_idx on public.softguard_sync_nonces (received_at);
create index if not exists softguard_sync_stage_run_entity_idx on public.softguard_sync_stage (sync_run_id, entidad);

create table if not exists public.softguard_tipos_servicio (
  codigo_tipo_servicio text primary key,
  tipo_servicio text,
  estado text,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  deactivated_at timestamptz,
  last_seen_sync_id uuid not null references public.softguard_sincronizaciones(sync_run_id)
);

create table if not exists public.softguard_abonados (
  id_interno text primary key,
  numero_abonado text,
  nombre_abonado text,
  direccion text,
  localidad text,
  primer_contacto text,
  telefono_primer_contacto text,
  codigo_tipo_servicio text references public.softguard_tipos_servicio(codigo_tipo_servicio),
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  deactivated_at timestamptz,
  last_seen_sync_id uuid not null references public.softguard_sincronizaciones(sync_run_id)
);

create table if not exists public.softguard_zonas (
  id_interno_zona text primary key,
  id_interno_abonado text not null references public.softguard_abonados(id_interno),
  numero_abonado text,
  codigo_zona text,
  descripcion_zona text,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  deactivated_at timestamptz,
  last_seen_sync_id uuid not null references public.softguard_sincronizaciones(sync_run_id)
);

create index if not exists softguard_abonados_numero_idx on public.softguard_abonados (numero_abonado);
create index if not exists softguard_abonados_nombre_idx on public.softguard_abonados using gin (to_tsvector('simple', coalesce(nombre_abonado, '')));
create index if not exists softguard_abonados_localidad_idx on public.softguard_abonados (localidad);
create index if not exists softguard_abonados_tipo_idx on public.softguard_abonados (codigo_tipo_servicio);
create index if not exists softguard_abonados_active_idx on public.softguard_abonados (is_active) where is_active;
create index if not exists softguard_zonas_abonado_idx on public.softguard_zonas (id_interno_abonado);
create index if not exists softguard_zonas_codigo_idx on public.softguard_zonas (codigo_zona);

alter table public.softguard_sincronizaciones enable row level security;
alter table public.softguard_sync_batches enable row level security;
alter table public.softguard_sync_stage enable row level security;
alter table public.softguard_sync_nonces enable row level security;
alter table public.softguard_tipos_servicio enable row level security;
alter table public.softguard_abonados enable row level security;
alter table public.softguard_zonas enable row level security;

revoke all on table public.softguard_sincronizaciones, public.softguard_sync_batches,
  public.softguard_sync_stage, public.softguard_sync_nonces, public.softguard_tipos_servicio,
  public.softguard_abonados, public.softguard_zonas from anon, authenticated;

create or replace function public.softguard_claim_request(
  p_nonce uuid,
  p_signed_at timestamptz,
  p_body_hash text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_signed_at < now() - interval '5 minutes' or p_signed_at > now() + interval '1 minute' then
    raise exception using errcode = '22023', message = 'SYNC_TIMESTAMP_OUTSIDE_WINDOW';
  end if;
  if p_body_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'SYNC_BODY_HASH_INVALID';
  end if;

  delete from public.softguard_sync_nonces where received_at < now() - interval '24 hours';
  if (select count(*) from public.softguard_sync_nonces where received_at >= now() - interval '1 minute') >= 120 then
    raise exception using errcode = '54000', message = 'SYNC_RATE_LIMITED';
  end if;

  begin
    insert into public.softguard_sync_nonces(nonce, signed_at, body_hash)
    values (p_nonce, p_signed_at, p_body_hash);
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'SYNC_REPLAY_DETECTED';
  end;
end;
$$;

create or replace function public.softguard_begin_sync(
  p_sync_run_id uuid,
  p_origen_generado_at timestamptz,
  p_abonados_esperados integer,
  p_zonas_esperadas integer,
  p_tipos_servicio_esperados integer,
  p_manifest_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.softguard_sincronizaciones%rowtype;
begin
  if least(p_abonados_esperados, p_zonas_esperadas, p_tipos_servicio_esperados) < 0
     or p_manifest_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'SYNC_MANIFEST_INVALID';
  end if;

  select * into existing from public.softguard_sincronizaciones where sync_run_id = p_sync_run_id;
  if found then
    if existing.origen_generado_at = p_origen_generado_at
       and existing.abonados_esperados = p_abonados_esperados
       and existing.zonas_esperadas = p_zonas_esperadas
       and existing.tipos_servicio_esperados = p_tipos_servicio_esperados
       and existing.manifest_hash = p_manifest_hash then
      return jsonb_build_object('syncRunId', p_sync_run_id, 'status', existing.estado, 'idempotent', true);
    end if;
    raise exception using errcode = '23505', message = 'SYNC_RUN_CONFLICT';
  end if;

  insert into public.softguard_sincronizaciones(
    sync_run_id, estado, origen_generado_at, abonados_esperados, zonas_esperadas,
    tipos_servicio_esperados, manifest_hash
  ) values (
    p_sync_run_id, 'receiving', p_origen_generado_at, p_abonados_esperados, p_zonas_esperadas,
    p_tipos_servicio_esperados, p_manifest_hash
  );
  return jsonb_build_object('syncRunId', p_sync_run_id, 'status', 'receiving', 'idempotent', false);
end;
$$;

create or replace function public.softguard_stage_batch(
  p_sync_run_id uuid,
  p_batch_id uuid,
  p_entidad text,
  p_batch_index integer,
  p_payload_hash text,
  p_records jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_status text;
  item jsonb;
  item_key text;
  item_count integer;
  existing public.softguard_sync_batches%rowtype;
begin
  if p_entidad not in ('abonados', 'zonas', 'tipos_servicio') or p_batch_index < 0
     or p_payload_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_records) <> 'array' then
    raise exception using errcode = '22023', message = 'SYNC_BATCH_INVALID';
  end if;
  item_count := jsonb_array_length(p_records);
  if item_count < 1 or item_count > 500 then
    raise exception using errcode = '22023', message = 'SYNC_BATCH_SIZE_INVALID';
  end if;

  select estado into run_status from public.softguard_sincronizaciones
  where sync_run_id = p_sync_run_id for update;
  if not found then raise exception using errcode = '23503', message = 'SYNC_RUN_NOT_FOUND'; end if;
  if run_status <> 'receiving' then raise exception using errcode = '55000', message = 'SYNC_RUN_NOT_RECEIVING'; end if;

  select * into existing from public.softguard_sync_batches
  where sync_run_id = p_sync_run_id and batch_id = p_batch_id;
  if found then
    if existing.entidad = p_entidad and existing.batch_index = p_batch_index
       and existing.payload_hash = p_payload_hash and existing.record_count = item_count then
      return jsonb_build_object('accepted', item_count, 'idempotent', true);
    end if;
    raise exception using errcode = '23505', message = 'SYNC_BATCH_CONFLICT';
  end if;

  insert into public.softguard_sync_batches(sync_run_id, batch_id, entidad, batch_index, payload_hash, record_count)
  values (p_sync_run_id, p_batch_id, p_entidad, p_batch_index, p_payload_hash, item_count);

  for item in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception using errcode = '22023', message = 'SYNC_RECORD_NOT_OBJECT';
    end if;
    item_key := trim(case p_entidad
      when 'abonados' then item->>'id_interno'
      when 'zonas' then item->>'id_interno_zona'
      else item->>'codigo_tipo_servicio'
    end);
    if item_key is null or item_key = '' or length(item_key) > 200 then
      raise exception using errcode = '23502', message = 'SYNC_RECORD_KEY_INVALID';
    end if;
    if p_entidad = 'zonas' and nullif(trim(item->>'id_interno_abonado'), '') is null then
      raise exception using errcode = '23502', message = 'SYNC_ZONE_SUBSCRIBER_KEY_INVALID';
    end if;
    insert into public.softguard_sync_stage(sync_run_id, entidad, record_key, payload, batch_id)
    values (p_sync_run_id, p_entidad, item_key, item, p_batch_id);
  end loop;

  return jsonb_build_object('accepted', item_count, 'idempotent', false);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'SYNC_DUPLICATE_KEY_OR_BATCH';
end;
$$;

create or replace function public.softguard_finalize_sync(p_sync_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.softguard_sincronizaciones%rowtype;
  actual_abonados integer;
  actual_zonas integer;
  actual_tipos integer;
begin
  -- Defensa adicional al mutex del Worker: sólo un snapshot puede publicarse a
  -- la vez, incluso si accidentalmente existen dos instalaciones emisoras.
  perform pg_catalog.pg_advisory_xact_lock(173647, 82931);
  select * into run from public.softguard_sincronizaciones where sync_run_id = p_sync_run_id for update;
  if not found then raise exception using errcode = '23503', message = 'SYNC_RUN_NOT_FOUND'; end if;
  if run.estado = 'completed' then
    return jsonb_build_object('syncRunId', p_sync_run_id, 'status', 'completed', 'idempotent', true);
  end if;
  if run.estado <> 'receiving' then raise exception using errcode = '55000', message = 'SYNC_RUN_NOT_RECEIVING'; end if;
  if exists (
    select 1 from public.softguard_sincronizaciones completed
    where completed.estado = 'completed' and completed.origen_generado_at > run.origen_generado_at
  ) then raise exception using errcode = '55000', message = 'SYNC_STALE_SNAPSHOT'; end if;

  select count(*) into actual_abonados from public.softguard_sync_stage where sync_run_id = p_sync_run_id and entidad = 'abonados';
  select count(*) into actual_zonas from public.softguard_sync_stage where sync_run_id = p_sync_run_id and entidad = 'zonas';
  select count(*) into actual_tipos from public.softguard_sync_stage where sync_run_id = p_sync_run_id and entidad = 'tipos_servicio';
  if actual_abonados <> run.abonados_esperados or actual_zonas <> run.zonas_esperadas or actual_tipos <> run.tipos_servicio_esperados then
    raise exception using errcode = '22000', message = 'SYNC_SNAPSHOT_COUNT_MISMATCH';
  end if;

  if exists (
    select 1 from public.softguard_sync_stage z
    where z.sync_run_id = p_sync_run_id and z.entidad = 'zonas'
      and not exists (
        select 1 from public.softguard_sync_stage a
        where a.sync_run_id = p_sync_run_id and a.entidad = 'abonados'
          and a.record_key = trim(z.payload->>'id_interno_abonado')
      )
  ) then raise exception using errcode = '23503', message = 'SYNC_ZONE_ORPHAN'; end if;

  if exists (
    select 1 from public.softguard_sync_stage a
    where a.sync_run_id = p_sync_run_id and a.entidad = 'abonados'
      and nullif(trim(a.payload->>'codigo_tipo_servicio'), '') is not null
      and not exists (
        select 1 from public.softguard_sync_stage t
        where t.sync_run_id = p_sync_run_id and t.entidad = 'tipos_servicio'
          and t.record_key = trim(a.payload->>'codigo_tipo_servicio')
      )
  ) then raise exception using errcode = '23503', message = 'SYNC_SERVICE_TYPE_ORPHAN'; end if;

  update public.softguard_sincronizaciones set estado = 'finalizing', updated_at = now() where sync_run_id = p_sync_run_id;

  insert into public.softguard_tipos_servicio(
    codigo_tipo_servicio, tipo_servicio, estado, is_active, last_synced_at, deactivated_at, last_seen_sync_id
  )
  select record_key, nullif(payload->>'tipo_servicio', ''), nullif(payload->>'estado', ''), true, now(), null, p_sync_run_id
  from public.softguard_sync_stage where sync_run_id = p_sync_run_id and entidad = 'tipos_servicio'
  on conflict (codigo_tipo_servicio) do update set
    tipo_servicio = excluded.tipo_servicio, estado = excluded.estado, is_active = true,
    last_synced_at = now(), deactivated_at = null, last_seen_sync_id = p_sync_run_id;

  insert into public.softguard_abonados(
    id_interno, numero_abonado, nombre_abonado, direccion, localidad, primer_contacto,
    telefono_primer_contacto, codigo_tipo_servicio, is_active, last_synced_at, deactivated_at, last_seen_sync_id
  )
  select record_key, nullif(payload->>'numero_abonado', ''), nullif(payload->>'nombre_abonado', ''),
    nullif(payload->>'direccion', ''), nullif(payload->>'localidad', ''), nullif(payload->>'primer_contacto', ''),
    nullif(payload->>'telefono_primer_contacto', ''), nullif(trim(payload->>'codigo_tipo_servicio'), ''),
    true, now(), null, p_sync_run_id
  from public.softguard_sync_stage where sync_run_id = p_sync_run_id and entidad = 'abonados'
  on conflict (id_interno) do update set
    numero_abonado = excluded.numero_abonado, nombre_abonado = excluded.nombre_abonado,
    direccion = excluded.direccion, localidad = excluded.localidad,
    primer_contacto = excluded.primer_contacto, telefono_primer_contacto = excluded.telefono_primer_contacto,
    codigo_tipo_servicio = excluded.codigo_tipo_servicio, is_active = true,
    last_synced_at = now(), deactivated_at = null, last_seen_sync_id = p_sync_run_id;

  insert into public.softguard_zonas(
    id_interno_zona, id_interno_abonado, numero_abonado, codigo_zona, descripcion_zona,
    is_active, last_synced_at, deactivated_at, last_seen_sync_id
  )
  select record_key, trim(payload->>'id_interno_abonado'), nullif(payload->>'numero_abonado', ''),
    nullif(payload->>'codigo_zona', ''), nullif(payload->>'descripcion_zona', ''),
    true, now(), null, p_sync_run_id
  from public.softguard_sync_stage where sync_run_id = p_sync_run_id and entidad = 'zonas'
  on conflict (id_interno_zona) do update set
    id_interno_abonado = excluded.id_interno_abonado, numero_abonado = excluded.numero_abonado,
    codigo_zona = excluded.codigo_zona, descripcion_zona = excluded.descripcion_zona,
    is_active = true, last_synced_at = now(), deactivated_at = null, last_seen_sync_id = p_sync_run_id;

  update public.softguard_zonas set is_active = false, deactivated_at = coalesce(deactivated_at, now()), last_synced_at = now()
  where is_active and last_seen_sync_id <> p_sync_run_id;
  update public.softguard_abonados set is_active = false, deactivated_at = coalesce(deactivated_at, now()), last_synced_at = now()
  where is_active and last_seen_sync_id <> p_sync_run_id;
  update public.softguard_tipos_servicio set is_active = false, deactivated_at = coalesce(deactivated_at, now()), last_synced_at = now()
  where is_active and last_seen_sync_id <> p_sync_run_id;

  -- Staging contiene datos personales y deja de ser necesario una vez que el
  -- snapshot quedó publicado. La trazabilidad agregada permanece en el run.
  delete from public.softguard_sync_stage where sync_run_id = p_sync_run_id;
  delete from public.softguard_sync_batches where sync_run_id = p_sync_run_id;

  update public.softguard_sincronizaciones set
    estado = 'completed', finalizado_at = now(),
    duracion_ms = greatest(0, (extract(epoch from (now() - created_at)) * 1000)::bigint),
    error_codigo = null, error_detalle = null, updated_at = now()
  where sync_run_id = p_sync_run_id;

  return jsonb_build_object(
    'syncRunId', p_sync_run_id, 'status', 'completed', 'idempotent', false,
    'counts', jsonb_build_object('abonados', actual_abonados, 'zonas', actual_zonas, 'tiposServicio', actual_tipos)
  );
end;
$$;

create or replace function public.softguard_fail_sync(
  p_sync_run_id uuid,
  p_error_codigo text,
  p_error_detalle text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.softguard_sincronizaciones set
    estado = case when estado = 'completed' then estado else 'failed' end,
    error_codigo = case when estado = 'completed' then error_codigo else left(coalesce(p_error_codigo, 'SYNC_FAILED'), 100) end,
    error_detalle = case when estado = 'completed' then error_detalle else left(coalesce(p_error_detalle, ''), 1000) end,
    updated_at = now()
  where sync_run_id = p_sync_run_id;
  delete from public.softguard_sync_stage where sync_run_id = p_sync_run_id;
  delete from public.softguard_sync_batches where sync_run_id = p_sync_run_id;
end;
$$;

revoke all on function public.softguard_claim_request(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.softguard_begin_sync(uuid, timestamptz, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.softguard_stage_batch(uuid, uuid, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.softguard_finalize_sync(uuid) from public, anon, authenticated;
revoke all on function public.softguard_fail_sync(uuid, text, text) from public, anon, authenticated;

grant execute on function public.softguard_claim_request(uuid, timestamptz, text) to service_role;
grant execute on function public.softguard_begin_sync(uuid, timestamptz, integer, integer, integer, text) to service_role;
grant execute on function public.softguard_stage_batch(uuid, uuid, text, integer, text, jsonb) to service_role;
grant execute on function public.softguard_finalize_sync(uuid) to service_role;
grant execute on function public.softguard_fail_sync(uuid, text, text) to service_role;

commit;
