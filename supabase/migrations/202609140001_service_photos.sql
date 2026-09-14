begin;

create table if not exists public.pignus_service_photos (
  record_id text primary key references public.pignus_work_history(id) on delete cascade,
  mime_type text not null,
  photo_data bytea not null,
  created_at timestamptz not null default now(),
  uploaded_by_id text,
  uploaded_by_name text
);

alter table public.pignus_service_photos enable row level security;
revoke all on table public.pignus_service_photos from anon, authenticated;

commit;
