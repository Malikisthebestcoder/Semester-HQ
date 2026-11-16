-- Run AFTER upgrade1.sql. Removes parent emails completely (works whether or not you already deployed).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, under_13, school_id)
  values (new.id, coalesce((new.raw_user_meta_data->>'under_13')::boolean, false),
    (select id from public.schools where lower(code) = lower(trim(new.raw_user_meta_data->>'school_code'))));
  return new;
end $$;

drop function public.owner_pending();
create function public.owner_pending() returns table(user_id uuid, email text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_owner) then raise exception 'owner only'; end if;
  return query select p.id, u.email::text from public.profiles p
    join auth.users u on u.id = p.id where p.under_13 and not p.parent_approved;
end $$;

alter table public.profiles drop column parent_email;
