-- PART A: run BEFORE deploying the new app.html (adds things only, breaks nothing)
create table if not exists public.engineer_customers (
  id uuid primary key default gen_random_uuid(),
  engineer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text default '', phone text default '', address text default '',
  house_number text default '', postcode text default '',
  is_company boolean not null default false,
  contact_person text default '', ref_prefix text default '',
  boiler text default '', notes text default '',
  linked_customer_id uuid references public.customers(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','marketplace','import','moti')),
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists engineer_customers_engineer_idx on public.engineer_customers(engineer_id);
create index if not exists engineer_customers_email_idx on public.engineer_customers(engineer_id, lower(email));
alter table public.engineer_customers enable row level security;
create policy "Engineers manage own customer records" on public.engineer_customers
  for all to authenticated using (engineer_id = auth.uid()) with check (engineer_id = auth.uid());
create policy "Admin read all engineer customers" on public.engineer_customers
  for select to authenticated using ((auth.jwt() ->> 'email') = 'njueephriam8@gmail.com');

-- PART B: run AFTER the new app.html is live (closes the leak)
drop policy if exists "Engineers can read customers"   on public.customers;
drop policy if exists "Engineers can insert customers" on public.customers;
drop policy if exists "Engineers can update customers" on public.customers;
create policy "Engineers read customers they serve" on public.customers
  for select to authenticated using (
    exists (select 1 from public.marketplace_jobs mj where mj.customer_id = customers.id
            and (mj.accepted_by = auth.uid() or mj.preferred_engineer_id = auth.uid()))
    or exists (select 1 from public.jobs j where j.customer_id = customers.id and j.engineer_id = auth.uid())
    or exists (select 1 from public.conversations c where c.customer_id = customers.id and c.engineer_id = auth.uid())
  );

-- 15 Nov 2026: save_engineer_job fixed (applied live)
--  * status/source text now mapped onto job_status / job_source enums
--    (diagnosed -> in_progress; unknown status -> upcoming; unknown source -> direct/marketplace)
--  * security: p_engineer_id must equal auth.uid()
--  * SET search_path = public; customer_id only linked if a customers row exists

-- 15 Nov 2026: PART B applied live, then recursion fix (policy subqueries on jobs/marketplace_jobs/
-- conversations re-entered customers RLS). Final version uses a SECURITY DEFINER helper:
-- create or replace function public.engineer_serves_customer(p_customer_id uuid) returns boolean
--   language sql stable security definer set search_path = public as $$
--   select auth.uid() is not null and (
--     exists (select 1 from marketplace_jobs mj where mj.customer_id = p_customer_id
--             and (mj.accepted_by = auth.uid() or mj.preferred_engineer_id = auth.uid()))
--     or exists (select 1 from jobs j where j.customer_id = p_customer_id and j.engineer_id = auth.uid())
--     or exists (select 1 from conversations c where c.customer_id = p_customer_id and c.engineer_id = auth.uid()));
--   $$;
-- create policy "Engineers read customers they serve" on public.customers
--   for select to authenticated using (public.engineer_serves_customer(id));

-- 15 Nov 2026 (0.2a, applied live): fixed saving
--  * save_certificate: dates cast safely, status derived from expiry (valid/expiring_soon/expired),
--    pass/fail kept in inspection_result, new p_data jsonb (full cert) -> cp12_certificates.data,
--    auth.uid() guard, only links real customer accounts
--  * send_invoice: sent_date now(), auth.uid() guard, never wipes customer link, only links real customers
--  * general_expenses: added category column + trigger filling hmrc_category (also fixes Moti log_expense)
