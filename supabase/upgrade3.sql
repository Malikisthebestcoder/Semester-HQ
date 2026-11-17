-- Run AFTER upgrade2.sql. Adds Home Access Center sync storage.
alter table public.classes add column source text not null default 'manual';
create table public.hac_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  enc text not null,
  updated_at timestamptz not null default now()
);
alter table public.hac_credentials enable row level security; -- no policies: only the server function can read it
