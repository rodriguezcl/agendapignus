alter table if exists normalized_shadow.customers
  add column if not exists cctv_service boolean not null default false;
