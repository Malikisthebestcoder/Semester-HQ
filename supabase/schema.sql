-- Run this once in Supabase: SQL Editor > New query > paste > Run.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  under_13 boolean not null default false,
  parent_email text,
  parent_approved boolean not null default false,
  is_owner boolean not null default false,
  is_premium boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  period int not null check (period between 0 and 12),
  points_earned numeric not null check (points_earned >= 0),
  points_possible numeric not null check (points_possible > 0),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.classes enable row level security;

-- Students under 13 can only use the app after a parent approves them.
create function public.can_use() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and (not p.under_13 or p.parent_approved))
$$;

-- Users can read their own profile but never edit it (approval, owner and premium flags are yours to set).
create policy "read own profile" on public.profiles for select using (id = auth.uid());
create policy "read own classes" on public.classes for select using (user_id = auth.uid());
create policy "add own classes" on public.classes for insert with check (user_id = auth.uid() and public.can_use());
create policy "edit own classes" on public.classes for update using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_use());
create policy "delete own classes" on public.classes for delete using (user_id = auth.uid());

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, under_13, parent_email)
  values (new.id, coalesce((new.raw_user_meta_data->>'under_13')::boolean, false), nullif(new.raw_user_meta_data->>'parent_email', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
