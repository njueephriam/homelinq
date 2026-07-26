-- ============================================================
-- HomeLinq — secure the boiler_passports table
-- Removes the wide-open RLS policies that let ANY user (including
-- anonymous) read, insert or update ANY boiler passport.
-- Keeps the intended access: customers see their own passport,
-- logged-in engineers see and manage passports.
-- Run once in: Supabase Dashboard > SQL Editor (Homelinq project).
-- ============================================================

-- 1. Remove the wide-open policies
drop policy if exists "bp_select" on public.boiler_passports;
drop policy if exists "bp_insert" on public.boiler_passports;
drop policy if exists "bp_update" on public.boiler_passports;
drop policy if exists "Anyone with share token" on public.boiler_passports;

-- 2. Keep engineers able to create boiler passports
drop policy if exists "Engineers insert passports" on public.boiler_passports;
create policy "Engineers insert passports"
  on public.boiler_passports for insert to public
  with check (exists (select 1 from public.engineers e where e.id = auth.uid()));

-- Resulting access:
--   SELECT  : a customer sees their own; a logged-in engineer sees all
--   INSERT  : logged-in engineers only
--   UPDATE  : logged-in engineers only (existing "Engineers update passports")
--   anonymous / arbitrary users: no access
