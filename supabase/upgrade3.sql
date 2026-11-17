-- Run AFTER upgrade2.sql. Marks which classes came from Home Access Center.
-- Passwords are never stored, so this also removes the old password table if you ran an earlier version.
alter table public.classes add column if not exists source text not null default 'manual';
drop table if exists public.hac_credentials;
