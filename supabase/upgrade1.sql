-- Run AFTER schema.sql. Adds school codes, class averages, owner tools, and Premium fields.
create table public.schools (id uuid primary key default gen_random_uuid(), name text not null, code text not null unique);
alter table public.schools enable row level security; -- no policies: only the functions below can read it
alter table public.profiles add column school_id uuid references public.schools(id),
  add column share_stats boolean not null default false, add column stripe_customer_id text;

create function public.school_name(p_code text) returns text
language sql security definer stable set search_path = public as $$
  select name from public.schools where lower(code) = lower(trim(p_code)) $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, under_13, parent_email, school_id)
  values (new.id, coalesce((new.raw_user_meta_data->>'under_13')::boolean, false),
    nullif(new.raw_user_meta_data->>'parent_email', ''),
    (select id from public.schools where lower(code) = lower(trim(new.raw_user_meta_data->>'school_code'))));
  return new;
end $$;

create function public.set_sharing(p_share boolean) returns void
language sql security definer set search_path = public as $$
  update public.profiles set share_stats = p_share where id = auth.uid() $$;

-- Averages only for students who share their own grades, same school + class + period, and only with 5+ students.
create function public.class_stats(p_class uuid) returns table(n int, mean numeric, a int, b int, c int, d int, f int)
language sql security definer stable set search_path = public as $$
  with me as (
    select c.name, c.period, p.school_id from public.classes c join public.profiles p on p.id = c.user_id
    where c.id = p_class and c.user_id = auth.uid() and p.share_stats and p.school_id is not null),
  pool as (
    select c.points_earned / c.points_possible * 100 as pct
    from public.classes c join public.profiles p on p.id = c.user_id
    join me on p.school_id = me.school_id and lower(c.name) = lower(me.name) and c.period = me.period
    where p.share_stats)
  select count(*)::int, round(avg(pct), 1),
    (count(*) filter (where pct >= 90))::int, (count(*) filter (where pct >= 80 and pct < 90))::int,
    (count(*) filter (where pct >= 70 and pct < 80))::int, (count(*) filter (where pct >= 60 and pct < 70))::int,
    (count(*) filter (where pct < 60))::int
  from pool having count(*) >= 5 $$;

create function public.owner_stats() returns json
language plpgsql security definer stable set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_owner) then raise exception 'owner only'; end if;
  return json_build_object('users', (select count(*) from public.profiles),
    'premium', (select count(*) from public.profiles where is_premium),
    'pending', (select count(*) from public.profiles where under_13 and not parent_approved));
end $$;

create function public.owner_pending() returns table(user_id uuid, email text, parent_email text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_owner) then raise exception 'owner only'; end if;
  return query select p.id, u.email::text, p.parent_email from public.profiles p
    join auth.users u on u.id = p.id where p.under_13 and not p.parent_approved;
end $$;

create function public.owner_approve(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_owner) then raise exception 'owner only'; end if;
  update public.profiles set parent_approved = true where id = p_user;
end $$;
