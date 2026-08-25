begin;

create table if not exists public.pignus_roles (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pignus_employees (
  id text primary key,
  email text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pignus_services (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pignus_customers (
  account text primary key,
  customer_id text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pignus_work_history (
  id text primary key,
  work_date date,
  status text,
  service_id text,
  customer_id text,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists pignus_work_history_date_idx on public.pignus_work_history (work_date desc);
create index if not exists pignus_work_history_service_idx on public.pignus_work_history (service_id);
create index if not exists pignus_work_history_customer_idx on public.pignus_work_history (customer_id);

create table if not exists public.pignus_agendas (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pignus_preferences (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pignus_reviews (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pignus_audit_log (
  id uuid primary key,
  occurred_at timestamptz not null,
  data jsonb not null
);

create index if not exists pignus_audit_log_occurred_idx on public.pignus_audit_log (occurred_at desc);

create table if not exists public.pignus_sessions (
  token_hash text primary key,
  employee_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists pignus_sessions_employee_idx on public.pignus_sessions (employee_id);
create index if not exists pignus_sessions_expiry_idx on public.pignus_sessions (expires_at);

create table if not exists public.pignus_login_attempts (
  fingerprint text primary key,
  attempts integer not null default 0,
  blocked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

insert into public.pignus_preferences (key, value)
values ('state_revision', '0'), ('theme', 'light')
on conflict (key) do nothing;

-- La aplicación accede exclusivamente desde su función de servidor mediante
-- DATABASE_URL. Ninguna tabla operativa queda expuesta al navegador por la Data API.
alter table public.pignus_roles enable row level security;
alter table public.pignus_employees enable row level security;
alter table public.pignus_services enable row level security;
alter table public.pignus_customers enable row level security;
alter table public.pignus_work_history enable row level security;
alter table public.pignus_agendas enable row level security;
alter table public.pignus_preferences enable row level security;
alter table public.pignus_reviews enable row level security;
alter table public.pignus_audit_log enable row level security;
alter table public.pignus_sessions enable row level security;
alter table public.pignus_login_attempts enable row level security;

revoke all on table public.pignus_roles, public.pignus_employees,
  public.pignus_services, public.pignus_customers, public.pignus_work_history,
  public.pignus_agendas, public.pignus_preferences, public.pignus_reviews,
  public.pignus_audit_log, public.pignus_sessions,
  public.pignus_login_attempts from anon, authenticated;

commit;

