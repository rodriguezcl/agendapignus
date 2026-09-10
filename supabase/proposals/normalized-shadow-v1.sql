-- Additive normalized storage contract. The production runner applies it only
-- after validating the certified revision and fingerprint. No legacy table is changed.
create schema if not exists normalized_shadow;
revoke all on schema normalized_shadow from public;

create table if not exists normalized_shadow.migration_contract (
  contract_key text primary key, contract_value text not null
);
insert into normalized_shadow.migration_contract (contract_key, contract_value)
values ('schema_version', 'normalized-v1-2026-09-09')
on conflict (contract_key) do nothing;
do $$
begin
  if (select contract_value from normalized_shadow.migration_contract where contract_key = 'schema_version') <> 'normalized-v1-2026-09-09' then
    raise exception 'El esquema normalized_shadow pertenece a otro contrato de migración.';
  end if;
end $$;

create table if not exists normalized_shadow.import_batch (
  id integer primary key check (id = 1),
  source_fingerprint text not null,
  source_revision bigint,
  status text not null check (status in ('rehearsal','shadow','active')),
  report jsonb not null
);
create table if not exists normalized_shadow.storage_control (
  id integer primary key check (id = 1),
  active_model text not null check (active_model in ('legacy','normalized')),
  active_revision bigint not null check (active_revision >= 0),
  active_fingerprint text,
  switch_id text,
  switched_at timestamptz
);
insert into normalized_shadow.storage_control (id, active_model, active_revision)
values (1, 'legacy', 0)
on conflict (id) do nothing;
create table if not exists normalized_shadow.storage_switch_events (
  id text primary key,
  from_model text not null check (from_model in ('legacy','normalized')),
  to_model text not null check (to_model in ('legacy','normalized')),
  source_revision bigint not null,
  source_fingerprint text not null,
  actor_id text,
  occurred_at timestamptz not null
);
create table if not exists normalized_shadow.roles (
  id text primary key, name text not null,
  code text unique, description text
);
create table if not exists normalized_shadow.role_permissions (
  role_id text not null references normalized_shadow.roles(id),
  permission text not null, allowed boolean not null,
  primary key (role_id, permission)
);
create table if not exists normalized_shadow.employees (
  id text primary key, role_id text not null references normalized_shadow.roles(id),
  name text not null, first_name text, last_name text,
  email text unique, phone text, status text
);
-- Security-domain tables are modeled but deliberately left empty in rehearsal.
-- Credential migration requires a separate privileged process; active legacy
-- sessions should be invalidated at cutover instead of copied.
create table if not exists normalized_shadow.employee_credentials (
  employee_id text primary key references normalized_shadow.employees(id) on delete cascade,
  password_hash text not null, changed_at timestamptz not null default now()
);
create table if not exists normalized_shadow.auth_sessions (
  token_hash text primary key,
  employee_id text not null references normalized_shadow.employees(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null
);
create index if not exists auth_sessions_employee_idx on normalized_shadow.auth_sessions(employee_id);
create index if not exists auth_sessions_expiry_idx on normalized_shadow.auth_sessions(expires_at);
create table if not exists normalized_shadow.login_attempts (
  fingerprint text primary key, attempts integer not null check (attempts >= 0),
  blocked_until timestamptz not null, updated_at timestamptz not null
);
create table if not exists normalized_shadow.customers (
  id text primary key, account text not null unique, name text not null,
  kind text, customer_type text, address text, street text, locality text,
  province text, phone text, converted_from_account text,
  subscription_ended_at timestamptz
);
create table if not exists normalized_shadow.customer_import_fields (
  customer_id text not null references normalized_shadow.customers(id),
  field_name text not null, field_value text,
  primary key (customer_id, field_name)
);
create table if not exists normalized_shadow.service_types (
  id text primary key, code text not null unique, name text not null,
  description text, category text, status text,
  system_managed boolean not null default false,
  estimated_minutes integer not null check (estimated_minutes between 15 and 720)
);
create table if not exists normalized_shadow.vehicles (
  id text primary key, plate text not null unique,
  brand text, model text, model_year integer,
  mileage integer check (mileage is null or mileage >= 0),
  mileage_updated_at timestamptz, mileage_updated_by_id text,
  mileage_updated_by_name text, insurance_expires_on date,
  insurance_file_name text, insurance_uploaded_at timestamptz,
  insurance_document_url text
);
create table if not exists normalized_shadow.vehicle_insurance_documents (
  vehicle_id text primary key references normalized_shadow.vehicles(id) on delete cascade,
  file_name text not null, pdf_data bytea not null,
  uploaded_at timestamptz not null
);
create table if not exists normalized_shadow.daily_teams (
  work_date date not null, team_key text not null,
  membership_resolved boolean not null,
  primary key (work_date, team_key)
);
create table if not exists normalized_shadow.team_members (
  work_date date not null, team_key text not null,
  employee_id text not null references normalized_shadow.employees(id),
  primary key (work_date, team_key, employee_id),
  foreign key (work_date, team_key) references normalized_shadow.daily_teams(work_date, team_key)
);
create table if not exists normalized_shadow.jobs (
  id text primary key,
  source_task_id text unique,
  legacy_task_id text,
  legacy_history_id text,
  job_kind text not null check (job_kind in ('service','vehicle_control')),
  work_date date not null,
  scheduled_date_snapshot text,
  scheduled_time time,
  estimated_minutes integer not null check (estimated_minutes between 15 and 720),
  status text not null check (status in ('Pendiente','Completado','Cancelado','Reprogramado','Requiere revisión')),
  customer_id text references normalized_shadow.customers(id),
  service_type_id text not null references normalized_shadow.service_types(id),
  team_key text,
  client_snapshot text, client_account_snapshot text,
  client_name_snapshot text, service_name_snapshot text,
  team_name_snapshot text, address_snapshot text, phone_snapshot text,
  detail text not null default '', internal_note text,
  installation_zone text, form_name text, amount_text text,
  monthly_fee_text text, payment_method text,
  estimated_minutes_customized boolean not null default false,
  new_customer boolean not null default false,
  manual_slot boolean not null default false,
  subscriber_reservation boolean not null default false,
  sort_order integer, monthly_vehicle_assignment text,
  rescheduled_from text, reprogrammed_at timestamptz,
  technician_request text, technical_status text, technical_observation text,
  completed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  needs_review boolean not null,
  foreign key (work_date, team_key) references normalized_shadow.daily_teams(work_date, team_key)
);
create index if not exists jobs_date_idx on normalized_shadow.jobs(work_date, scheduled_time);
create index if not exists jobs_customer_idx on normalized_shadow.jobs(customer_id, work_date);
create table if not exists normalized_shadow.vehicle_controls (
  job_id text primary key references normalized_shadow.jobs(id),
  vehicle_id text not null references normalized_shadow.vehicles(id),
  scheduled_friday date not null,
  mileage_at_scheduling integer check (mileage_at_scheduling is null or mileage_at_scheduling >= 0),
  reported_mileage integer check (reported_mileage is null or reported_mileage >= 0),
  vehicle_brand_snapshot text, vehicle_model_snapshot text,
  vehicle_plate_snapshot text,
  unique (vehicle_id, scheduled_friday)
);
create table if not exists normalized_shadow.vehicle_control_photos (
  job_id text primary key references normalized_shadow.vehicle_controls(job_id) on delete cascade,
  vehicle_id text not null references normalized_shadow.vehicles(id),
  mime_type text not null, photo_data bytea not null,
  created_at timestamptz not null
);
create table if not exists normalized_shadow.service_assignments (
  job_id text not null references normalized_shadow.jobs(id),
  employee_id text not null references normalized_shadow.employees(id),
  primary key (job_id, employee_id)
);
create index if not exists service_assignments_employee_idx on normalized_shadow.service_assignments(employee_id, job_id);
create table if not exists normalized_shadow.job_checklist_items (
  job_id text not null references normalized_shadow.jobs(id),
  item_id text not null, position integer not null check (position >= 0),
  item_text text not null, completed boolean not null,
  primary key (job_id, item_id), unique (job_id, position)
);
create table if not exists normalized_shadow.job_events (
  job_id text not null references normalized_shadow.jobs(id),
  event_kind text not null check (event_kind in ('created','reservation_created','reservation_linked','technical_reported')),
  occurred_at timestamptz, employee_id text,
  actor_name text, actor_role text,
  primary key (job_id, event_kind)
);
create table if not exists normalized_shadow.job_reservations (
  job_id text primary key references normalized_shadow.jobs(id),
  original_name text, original_address text, original_phone text
);
create table if not exists normalized_shadow.planned_days (
  scope text not null check (scope in ('weekly','daily')),
  work_date date not null, primary key (scope, work_date)
);
create table if not exists normalized_shadow.planned_teams (
  scope text not null, work_date date not null, team_key text not null,
  position integer not null check (position >= 0), display_label text,
  primary key (scope, work_date, team_key), unique (scope, work_date, position),
  foreign key (scope, work_date) references normalized_shadow.planned_days(scope, work_date)
);
create table if not exists normalized_shadow.planned_team_members (
  scope text not null, work_date date not null, team_key text not null,
  employee_id text not null references normalized_shadow.employees(id),
  primary key (scope, work_date, team_key, employee_id),
  foreign key (scope, work_date, team_key) references normalized_shadow.planned_teams(scope, work_date, team_key)
);
create table if not exists normalized_shadow.planned_slots (
  id text primary key, scope text not null, work_date date not null,
  team_key text not null, position integer not null check (position >= 0),
  candidate_job_id text references normalized_shadow.jobs(id),
  slot_kind text not null check (slot_kind in ('linked_job','availability','unlinked_service','unlinked_vehicle_control')),
  scheduled_time time, status_snapshot text,
  unique (scope, work_date, team_key, position),
  foreign key (scope, work_date, team_key) references normalized_shadow.planned_teams(scope, work_date, team_key)
);
create table if not exists normalized_shadow.monthly_configurations (
  period text primary key check (period ~ '^[0-9]{4}-[0-9]{2}$')
);
create table if not exists normalized_shadow.monthly_default_times (
  period text not null references normalized_shadow.monthly_configurations(period),
  source_kind text not null check (source_kind in ('default','period')),
  effective_from text not null, position integer not null check (position >= 0),
  default_time time not null,
  primary key (period, source_kind, effective_from, position)
);
create table if not exists normalized_shadow.monthly_teams (
  period text not null references normalized_shadow.monthly_configurations(period),
  team_key text not null, position integer not null check (position >= 0),
  display_label text, primary key (period, team_key), unique (period, position)
);
create table if not exists normalized_shadow.monthly_team_members (
  period text not null, team_key text not null,
  employee_id text not null references normalized_shadow.employees(id),
  primary key (period, team_key, employee_id),
  foreign key (period, team_key) references normalized_shadow.monthly_teams(period, team_key)
);
create table if not exists normalized_shadow.monthly_vehicle_assignments (
  period text not null references normalized_shadow.monthly_configurations(period),
  position integer not null check (position >= 0),
  vehicle_id text not null references normalized_shadow.vehicles(id),
  employee_id text not null references normalized_shadow.employees(id),
  vehicle_snapshot text, technician_snapshot text,
  primary key (period, position), unique (period, vehicle_id)
);
create table if not exists normalized_shadow.annual_guard_plans (
  plan_year integer primary key check (plan_year between 2000 and 2200),
  start_date date not null
);
create table if not exists normalized_shadow.annual_guard_rotation (
  plan_year integer not null references normalized_shadow.annual_guard_plans(plan_year),
  position integer not null check (position >= 0),
  employee_id text not null references normalized_shadow.employees(id),
  technician_snapshot text, primary key (plan_year, position)
);
create table if not exists normalized_shadow.holiday_overrides (
  work_date date primary key, status text not null,
  holiday_name text, decided_at timestamptz,
  decided_by_id text, decided_by_name text
);
create table if not exists normalized_shadow.app_preferences (
  preference_key text primary key, preference_value text not null
);
create table if not exists normalized_shadow.legacy_preference_evidence (
  preference_key text primary key, preference_value text not null,
  updated_at timestamptz not null
);
create table if not exists normalized_shadow.audit_events (
  id uuid primary key, occurred_at timestamptz not null,
  actor_employee_id text, actor_name text, actor_email text, actor_role text,
  action text not null, entity text not null, entity_id text,
  before_payload jsonb, after_payload jsonb,
  original_payload jsonb not null
);
create index if not exists audit_events_occurred_idx on normalized_shadow.audit_events(occurred_at desc);
-- Immutable source evidence permits rollback and forensic comparison. Employee
-- password/passwordHash fields are deliberately excluded before insertion.
create table if not exists normalized_shadow.source_record_evidence (
  collection text not null check (collection in ('roles','employees_without_credentials','customers','service_types','vehicles','reviews')),
  record_id text not null, source_position integer not null check (source_position >= 0),
  original_payload jsonb not null,
  primary key (collection, record_id)
);
-- Archives are evidence, not a second mutable representation of the service.
create table if not exists normalized_shadow.history_evidence (
  job_id text primary key references normalized_shadow.jobs(id),
  source_position integer not null check (source_position >= 0),
  original_payload jsonb not null
);
create table if not exists normalized_shadow.agenda_plan_evidence (
  scope text not null check (scope in ('weekly','daily')),
  work_date date not null, original_payload jsonb not null,
  primary key (scope, work_date)
);
create table if not exists normalized_shadow.agenda_evidence (
  id text primary key,
  scope text not null check (scope in ('weekly','daily')),
  work_date date not null,
  original_team_id text not null,
  candidate_job_id text references normalized_shadow.jobs(id),
  original_payload jsonb not null
);
create table if not exists normalized_shadow.configuration_evidence (
  config_key text primary key, original_payload jsonb not null
);
create table if not exists normalized_shadow.configuration_event_evidence (
  id text primary key, config_kind text not null,
  period text, occurred_at timestamptz, original_payload jsonb not null
);
create table if not exists normalized_shadow.reconciliation_cases (
  id text primary key, kind text not null,
  severity text not null check (severity in ('info','review','error')),
  location text not null, record_id text,
  details jsonb not null,
  status text not null default 'open' check (status in ('open','approved'))
);
-- No browser/data-API role can use these tables. Privileged rehearsal connection only.
do $$
declare item record;
begin
  for item in select tablename from pg_tables where schemaname = 'normalized_shadow' loop
    execute format('alter table normalized_shadow.%I enable row level security', item.tablename);
    execute format('revoke all on table normalized_shadow.%I from public', item.tablename);
  end loop;
end $$;
