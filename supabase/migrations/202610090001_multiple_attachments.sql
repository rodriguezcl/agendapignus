-- Independent binary storage; metadata is fetched only when opening attachments.
-- Existing service photos, control photos and insurance documents remain intact.
create table if not exists public.pignus_attachments (
  scope text not null,
  entity_id text not null,
  id text not null,
  file_name text not null,
  mime_type text not null,
  byte_size integer not null,
  digest text not null,
  content bytea not null,
  created_at timestamptz not null,
  uploaded_by text not null,
  primary key (scope, entity_id, id)
);
alter table public.pignus_attachments enable row level security;
revoke all on table public.pignus_attachments from anon, authenticated;
