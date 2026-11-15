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

-- 15 Nov 2026 (0.2c SECURITY, applied live): migration "security_lockdown_definer_functions"
--  * helpers public.is_service_role(), public.is_admin()
--  * every SECURITY DEFINER app function now starts with
--      IF NOT (is_service_role() OR <caller owns the data>) THEN RAISE 'Not authorised'
--  * EXECUTE revoked from anon/PUBLIC on all of them except get_feed, get_post_comments (public feed)
--  * record_payment, update_stripe_account: service role only
--  * duplicate save_quote (jsonb version) dropped; text version casts jsonb/timestamptz
--  * save_mileage date cast + trigger mileage_log_sync_columns (two sets of columns kept in sync)
--  * update_quote_by_number only matches the caller's own quotes; update_job_status enum cast
--  * default privileges: new functions not executable by anon
-- Edge functions: send-email v31 (approved engineers/admin only; generic renders safe HTML),
--                 moti-engineer v17 (emails sent with the engineer's own login)

-- 15 Nov 2026 (0.2d, applied live): migration "fix_0_2d_emergency_numbering_verification"
--  * price_type enum gains 'out_of_hours' (emergency bookings now create marketplace jobs)
--  * duplicate invoice/quote numbers renamed with -B,-C...; unique (engineer_id, number) indexes
--  * next_invoice_number(); triggers auto-number invoices/quotes when number is blank
--  * complete_job: proper numbering, VAT only if engineer vat_registered
--  * private storage bucket 'verification-docs' (engineer uploads to own folder; admin can read)

-- 15 Nov 2026 (0.2e, applied live): migration "engineer_customers_backfill_and_auto_add"
--  * source values now include 'backfill','auto'
--  * ensure_engineer_customer(): add customer to engineer's list if missing (match email, else name; fills gaps only)
--  * AFTER INSERT triggers on jobs, invoices, quotes, cp12_certificates call it (errors never block the save)
--  * one-off backfill from marketplace_jobs, jobs, quotes, invoices, certificates

-- 15 Nov 2026 (0.2f, applied live): migration "customer_links_invoice_items_vat"
--  * engineer_customer_id on jobs, invoices, quotes (+ backfill: all existing rows linked)
--  * invoices.items jsonb, invoices.vat_rate, invoices.meta jsonb (address, phone, company, vat number)
--  * auto-customer trigger now BEFORE INSERT and stores the link on the row
--  * save_engineer_job(+p_engineer_customer_id), send_invoice(+items, vat_rate, link, due date, meta, paid status/method)
--  * already-paid callout invoices now saved as paid (previously saved as unpaid)

-- 15 Nov 2026 (0.2b, applied live): migration "import_batch_columns"
--  * import_batch_id on jobs, invoices, cp12_certificates, general_expenses (+ indexes; engineer_customers already had it)
--  App importer now: CSV + Excel, saves all 5 types in batches of 200, keeps phone zeros, UK dates,
--  duplicate skipping, imported invoices as IMP-<original> (never emailed/chased), certificates kept as
--  records of the original engineer, escaped file content in the preview.

-- 15 Nov 2026 (Phase 1A-M1, applied live): migration "import_batches_and_templates"
--  * import_batches (owner-only RLS, admin read): status, source_software, files, counts, progress
--  * import_templates (shared column-matching templates; read by signed-in users; written by moti-import later)
