-- Run AFTER upgrade3.sql. Adds sign-in through Home Access Center only.
alter table public.profiles
  add column if not exists hac_hash text unique,
  add column if not exists hac_username text;

-- The owner panel now shows each waiting student's HAC username.
create or replace function public.owner_pending() returns table(user_id uuid, email text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_owner) then raise exception 'owner only'; end if;
  return query select p.id, coalesce(p.hac_username, u.email::text) from public.profiles p
    join auth.users u on u.id = p.id where p.under_13 and not p.parent_approved;
end $$;
