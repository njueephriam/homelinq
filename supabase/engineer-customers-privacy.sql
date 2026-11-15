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

-- ===== M2.5 (2026-11-15): Moti import conversation — daily fair-use counter =====
create table if not exists public.moti_import_usage(
  engineer_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  calls int not null default 0,
  primary key(engineer_id, day)
);
alter table public.moti_import_usage enable row level security;
create policy "Engineers read own Moti import usage" on public.moti_import_usage for select using (engineer_id = auth.uid());
create or replace function public.bump_moti_import_usage(p_engineer uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.is_service_role() then raise exception 'Not authorised'; end if;
  insert into public.moti_import_usage(engineer_id, day, calls) values (p_engineer, current_date, 1)
  on conflict (engineer_id, day) do update set calls = moti_import_usage.calls + 1
  returning calls into v;
  return v;
end $$;
revoke execute on function public.bump_moti_import_usage(uuid) from public, anon, authenticated;

-- ===== M4 (2026-11-15): import undo + auto-created customers tagged with the import =====
-- Applied live as migration "m4_import_undo_and_auto_customer_batch_tag":
--  * trg_auto_engineer_customer(): when an imported job/invoice/certificate auto-creates a customer in the same
--    transaction (created_at = now()), the customer gets the same import_batch_id.
--  * indexes on invoices/mileage_log/reminders/reviews/job_expenses (job_id).
--  * undo_import_batch(p_batch uuid) returns jsonb — owner or service role only; deletes up to 5,000 rows per call
--    (client calls again while done=false): invoices, certificates, expenses, jobs without newer work, customers
--    without newer work; then reverts "fill in missing details" values recorded in import_batches.progress.fills
--    (only where the value is unchanged) and marks the batch 'undone'. Granted to authenticated, revoked from anon.
-- Tested in a rolled-back transaction: removes imported + auto-created rows, keeps a job with a later invoice,
-- reverts a filled phone, blocks other users.

-- ===== Phase 2A B1 (2026-11-15): the books =====
-- Migration "books_b1_sources_vat_settings_and_payment_lockdown" (applied live):
--  * SECURITY: dropped policy pt_service_all on payment_transactions (it let EVERY signed-in user read and change all
--    payment rows); revoked insert/update/delete/truncate from authenticated + anon. Engineers/customers keep read of their own.
--  * created_via text default 'app' (app|moti|import|photo|system|marketplace) on invoices, jobs, quotes, general_expenses,
--    job_expenses, mileage_log; backfilled import / marketplace.
--  * vat, vat_rate on general_expenses and job_expenses.
--  * engineers.vehicle_method (mileage_allowance|actual_costs, null = not chosen -> mileage allowance),
--    engineers.accounting_basis (cash default | accruals).
--  * sa103_box(category) -> SA103F expense box 17-30.
-- Migration "books_b1_get_books_and_complete_job_v2":
--  * tax_year_start(date).
--  * get_books(p_from, p_to, p_lines default true, p_include_imported default true) -> jsonb {period, engineer, summary, lines}
--    owner-only (auth.uid()); income when paid (cash) or invoiced (accruals); marketplace payments without a paid invoice;
--    money owed; general + all job expenses (billable included); platform fees (box 30); mileage with 45p/25p per tax year;
--    fuel/van not claimed under mileage allowance; summary incl. SA103F boxes. Tested in a rolled-back transaction.
--  * complete_job(p_job_id, p_vat_rate default null, p_via default 'app'): VAT is the engineer's choice (required if
--    VAT-registered, 0/5/20), never invoices / logs mileage / sets reminder twice, tags created_via. Old complete_job(uuid) dropped.

-- ===== Phase 2 (2026-11-15): photos + Moti activity =====
-- Migration "phase2_p1_activity_photos" (applied live):
--  * moti_activity (engineer_id, at, kind proposed|approved|declined|done|failed, tool, summary, record_table, record_id,
--    amount, source chat|photo|end_of_day|import, detail) — engineers read own; insert/update/delete revoked (server writes).
--  * job_photos (engineer_id, job_id, storage_bucket job-photos|receipts, storage_path, caption, kind, created_via) — owner RLS.
--  * storage.objects policies: engineers insert/select/delete only in job-photos & receipts under folder <their uid>/.
--  * boiler_passports.gc_number, fuel_type, output_kw; jobs.notes.
-- Migration "phase2_p1_log_import_activity": log_import_activity(batch) — owner only, logs a finished import once.
-- Tested (rolled back): own photos only, can't write others' photos or the activity log, storage folder enforced,
-- import logged once, can't read others' activity.
-- NOTE (open question for the owner): boiler_passports policies let ANY engineer read/update ANY passport (addresses).

-- ============================================================
-- Phase 3 D1 (15 Nov 2026): suppliers & parts log  [migration phase3_d1_parts_log]
-- ============================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  engineer_id uuid not null references auth.users(id) on delete cascade,
  name text not null, branch text not null default '', account_number text,
  created_at timestamptz not null default now()
);
create unique index if not exists suppliers_uniq on public.suppliers(engineer_id, lower(name), lower(branch));
alter table public.suppliers enable row level security;
drop policy if exists "Engineers manage own suppliers" on public.suppliers;
create policy "Engineers manage own suppliers" on public.suppliers for all using (engineer_id = auth.uid()) with check (engineer_id = auth.uid());
create or replace function public.part_match_key(p_part_number text, p_name text) returns text language sql immutable as $$
  select case when nullif(regexp_replace(upper(coalesce(p_part_number,'')), '[^A-Z0-9]', '', 'g'), '') is not null
              then 'PN:' || regexp_replace(upper(p_part_number), '[^A-Z0-9]', '', 'g')
              else 'NM:' || regexp_replace(lower(trim(coalesce(p_name,''))), '\s+', ' ', 'g') end
$$;
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  engineer_id uuid not null references auth.users(id) on delete cascade,
  name text not null, manufacturer text, part_number text, category text not null default 'cogs',
  match_key text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists parts_uniq on public.parts(engineer_id, match_key);
create index if not exists parts_pn on public.parts(match_key);
alter table public.parts enable row level security;
drop policy if exists "Engineers manage own parts" on public.parts;
create policy "Engineers manage own parts" on public.parts for all using (engineer_id = auth.uid()) with check (engineer_id = auth.uid());
create table if not exists public.part_prices (
  id uuid primary key default gen_random_uuid(),
  engineer_id uuid not null references auth.users(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  unit_price numeric not null check (unit_price >= 0),
  vat numeric not null default 0, qty numeric not null default 1 check (qty > 0),
  bought_on date not null default current_date,
  supplier_code text, job_id uuid references public.jobs(id) on delete set null, photo_id uuid references public.job_photos(id) on delete set null,
  source text not null default 'manual' check (source in ('receipt','manual','import','photo','moti')),
  created_at timestamptz not null default now()
);
create index if not exists part_prices_part on public.part_prices(part_id, bought_on desc);
alter table public.part_prices enable row level security;
drop policy if exists "Engineers manage own part prices" on public.part_prices;
create policy "Engineers manage own part prices" on public.part_prices for all using (engineer_id = auth.uid()) with check (engineer_id = auth.uid());
alter table public.engineers add column if not exists share_part_prices boolean not null default true;
create or replace function public.log_part_purchase(p_supplier text, p_branch text, p_bought_on date, p_lines jsonb, p_job_id uuid default null, p_source text default 'manual')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid; pid uuid; l jsonb; n int := 0; k text; src text;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'No parts given'; end if;
  if jsonb_array_length(p_lines) > 40 then raise exception 'Too many lines (max 40)'; end if;
  src := case when p_source in ('receipt','manual','import','photo','moti') then p_source else 'manual' end;
  if nullif(trim(coalesce(p_supplier,'')),'') is not null then
    insert into public.suppliers(engineer_id, name, branch) values (uid, trim(p_supplier), coalesce(trim(p_branch),''))
      on conflict (engineer_id, lower(name), lower(branch)) do update set name = excluded.name returning id into sid;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if nullif(trim(coalesce(l->>'name','')),'') is null or (l->>'unit_price') is null then continue; end if;
    k := public.part_match_key(l->>'part_number', l->>'name');
    insert into public.parts(engineer_id, name, manufacturer, part_number, category, match_key)
      values (uid, left(trim(l->>'name'),200), nullif(trim(coalesce(l->>'manufacturer','')),''), nullif(trim(coalesce(l->>'part_number','')),''), coalesce(nullif(l->>'category',''),'cogs'), k)
      on conflict (engineer_id, match_key) do update set
        manufacturer = coalesce(public.parts.manufacturer, excluded.manufacturer),
        part_number = coalesce(public.parts.part_number, excluded.part_number), updated_at = now()
      returning id into pid;
    insert into public.part_prices(engineer_id, part_id, supplier_id, unit_price, vat, qty, bought_on, supplier_code, job_id, source)
      values (uid, pid, sid, round((l->>'unit_price')::numeric, 2), round(coalesce((l->>'vat')::numeric, 0), 2), greatest(coalesce((l->>'qty')::numeric, 1), 0.01),
              coalesce(p_bought_on, current_date), nullif(trim(coalesce(l->>'supplier_code','')),''), p_job_id, src);
    n := n + 1;
  end loop;
  return jsonb_build_object('logged', n, 'supplier_id', sid);
end $$;
revoke execute on function public.log_part_purchase(text, text, date, jsonb, uuid, text) from public, anon;
grant execute on function public.log_part_purchase(text, text, date, jsonb, uuid, text) to authenticated;

create or replace function public.part_price_pool(p_match_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null or not exists (select 1 from public.engineers where id = auth.uid()) then raise exception 'Engineers only'; end if;
  if p_match_key is null or left(p_match_key, 3) <> 'PN:' then return jsonb_build_object('enough', false, 'reason', 'Shared prices need the maker''s part number'); end if;
  select count(distinct pp.engineer_id) as engineers, count(*) as n,
         min(pp.unit_price) as lo, percentile_cont(0.5) within group (order by pp.unit_price) as mid, max(pp.unit_price) as hi
    into r
    from public.part_prices pp join public.parts p on p.id = pp.part_id join public.engineers e on e.id = pp.engineer_id
   where p.match_key = p_match_key and coalesce(e.share_part_prices, true) and pp.bought_on >= current_date - 365;
  if coalesce(r.engineers, 0) < 3 then return jsonb_build_object('enough', false, 'engineers', coalesce(r.engineers,0)); end if;
  return jsonb_build_object('enough', true, 'engineers', r.engineers, 'prices', r.n, 'low', round(r.lo, 2), 'typical', round(r.mid::numeric, 2), 'high', round(r.hi, 2));
end $$;
revoke execute on function public.part_price_pool(text) from public, anon;
grant execute on function public.part_price_pool(text) to authenticated;

create or replace function public.find_parts(p_query text default '', p_limit int default 30)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'last_bought') desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'name', p.name, 'manufacturer', p.manufacturer, 'part_number', p.part_number, 'category', p.category, 'match_key', p.match_key,
      'times_bought', (select count(*) from public.part_prices pp where pp.part_id = p.id),
      'last_bought', (select max(bought_on) from public.part_prices pp where pp.part_id = p.id),
      'last', (select jsonb_build_object('price', pp.unit_price, 'date', pp.bought_on, 'supplier', s.name || case when s.branch <> '' then ' (' || s.branch || ')' else '' end, 'code', pp.supplier_code)
               from public.part_prices pp left join public.suppliers s on s.id = pp.supplier_id where pp.part_id = p.id order by pp.bought_on desc, pp.created_at desc limit 1),
      'cheapest', (select jsonb_build_object('price', pp.unit_price, 'date', pp.bought_on, 'supplier', s.name || case when s.branch <> '' then ' (' || s.branch || ')' else '' end)
               from public.part_prices pp left join public.suppliers s on s.id = pp.supplier_id where pp.part_id = p.id and pp.bought_on >= current_date - 365 order by pp.unit_price asc, pp.bought_on desc limit 1)) as x
    from public.parts p
    where p.engineer_id = auth.uid()
      and (coalesce(p_query,'') = '' or p.name ilike '%' || p_query || '%' or coalesce(p.part_number,'') ilike '%' || p_query || '%' or coalesce(p.manufacturer,'') ilike '%' || p_query || '%'
           or exists (select 1 from public.part_prices pp where pp.part_id = p.id and coalesce(pp.supplier_code,'') ilike '%' || p_query || '%'))
    limit greatest(1, least(coalesce(p_limit, 30), 200))
  ) q
$$;
revoke execute on function public.find_parts(text, int) from public, anon;
grant execute on function public.find_parts(text, int) to authenticated;
-- Tested (rolled back): same pump from 2 suppliers merges on maker number (994-11158 = 99411158), last vs cheapest correct,
-- merchant code searchable, other engineers can't see or write your parts, shared range hidden below 3 engineers and for name-only parts.
