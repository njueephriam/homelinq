# HomeLinq — Complete Project Handover

## 1. WHAT HOMELINQ IS

HomeLinq is a platform connecting UK homeowners with Gas Safe registered engineers for boiler repairs, servicing, installations, and gas safety certificates. The KEY selling point is **auto-invoicing** — gas engineers finish work and HomeLinq eliminates ALL admin.

- **Registered business**: Infinite Life Records LTD (HomeLinq is a trading name)
- **Owner**: Ephriam Njue (njueephriam8@gmail.com)
- **Live URL**: https://homelinq.co.uk (hosted on Netlify, auto-deploys from GitHub)
- **GitHub repo**: https://github.com/njueephriam/homelinq
- **Status**: LIVE as of August 2026

---

## 2. STANDING INSTRUCTIONS (CRITICAL — follow these always)

1. **"Whenever I ask us to add a feature, let me know if it's a good idea or not and how to refine it before executing"** — Assess first, build second.
2. **"If a change will need to affect A to Z, make sure it actually touches A to Z"** — No half-done changes.
3. **"Do all updates on one file HOMELI~1/app.html and stop creating multiples"** — NO zip files, NO duplicate folders. All changes go to the single source file. (admin.html, privacy.html, terms.html are acceptable separate files.)
4. **Pricing model**: Engineers set their own rates. No additional labour charges. Platform fee is fixed £15 per callout.

---

## 3. TECH STACK

- **Frontend**: Single-file HTML prototype (`app.html` ~10,400 lines) with vanilla JS
- **CRITICAL CODE RULES**: 
  - NO template literals (use string concatenation only)
  - NO ES6 (no `let`, `const`, arrow functions)
  - `var` everywhere, `function(){}` everywhere
  - ES5 only throughout
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions + RLS + Storage)
- **Payments**: Stripe Connect Express with destination charges
- **Email**: Resend (via send-email edge function), from noreply@homelinq.co.uk
- **PWA**: Service worker (`moti-sw.js`, cache version currently v14)
- **Address lookup**: postcodes.io (UK postcode, free, no key) + Nominatim/OpenStreetMap (street address)
- **Hosting**: Netlify (auto-deploys from GitHub `main` branch)

---

## 4. FILE STRUCTURE

All files live in `HOMELI~1/` folder on the user's PC at:
`C:\Users\njuee\OneDrive\Desktop\My Business plan\INFINITE LIFE RECORD\homelinq\HOMELI~1\`

The GitHub repo (for deployment) is at:
`C:\Users\njuee\OneDrive\Documents\GitHub\homelinq\`

**Files must be copied from HOMELI~1 → GitHub folder, then pushed.** The deploy command:
```
xcopy "C:\Users\njuee\OneDrive\Desktop\My Business plan\INFINITE LIFE RECORD\homelinq\HOMELI~1\*" "C:\Users\njuee\OneDrive\Documents\GitHub\homelinq\" /E /Y
cd /d C:\Users\njuee\OneDrive\Documents\GitHub\homelinq
git add .
git commit -m "Your commit message"
git push
```

### Key files:

| File | Purpose |
|------|---------|
| `app.html` (~10,400 lines) | THE main product — engineer app + customer app in one file |
| `index.html` (~316KB) | Public landing page / marketing site (SEO-optimized) |
| `admin.html` (~146KB) | Admin dashboard with Sales CRM (same ES5 constraints) |
| `privacy.html` | UK GDPR-compliant privacy policy |
| `terms.html` | Terms of service |
| `moti-sw.js` | PWA service worker (cache version v14) |
| `moti.html` | Moti AI assistant page |
| `moti/` | Moti subfolder (config.js, icons, JS modules) |
| `app-manifest.json` | PWA manifest for HomeLinq |
| `moti-manifest.json` | PWA manifest for Moti |
| `robots.txt` | Search engine crawler rules |
| `sitemap.xml` | SEO sitemap |
| `_redirects` | Netlify redirect rules |
| `ai-diagnostic.png` | AI diagnostic feature image |
| `signature-*.html` | Email signature templates |
| `supabase/` | Supabase config and SQL files |
| `supabase-edge/` | Edge function source code (reference copies) |
| `.gitignore` | Git ignore rules |

---

## 5. SUPABASE CONFIGURATION

- **Project ID**: `uphlvpatjhdnqcsytvaz`
- **URL**: `https://uphlvpatjhdnqcsytvaz.supabase.co`
- **Anon Key**: In app.html line 380 (variable name is `SUPABASE_KEY`, NOT `SUPABASE_ANON_KEY`)
- **Edge function base URL**: `SUPABASE_URL + '/functions/v1'`
- **Storage bucket**: "invoices" (public) — for hosted invoice HTML
- **RLS**: Enabled on ALL 37 tables

### Database tables (37 total):
boiler_history, boiler_passport_history, boiler_passports, certificate_lookups, chatbot_knowledge, chatbot_logs, community_comments, community_posts, companies, conversations, cp12_certificates, customers, daily_notes, date_reminders, engineers, general_expenses, invoices, job_expenses, jobs, leads, marketplace_jobs, messages, mileage_log, moti_feedback, moti_knowledge, moti_messages, news_sources, outreach_emails, payment_transactions, profiles, push_subscriptions, quotes, reminders, reviews, social_comments, social_likes, social_posts

### Key RPC functions (custom):
- `save_engineer_job` — Upsert jobs (text→date cast for scheduled_date)
- `save_certificate` — Upsert CP12 certificates
- `save_boiler_passport` — Upsert boiler passports with history
- `save_quote` / `update_quote_by_number` — Quote management
- `send_invoice` — Save invoice to Supabase
- `send_message` / `mark_messages_read` — Messaging system
- `load_conversations` / `load_boiler_passports` / `load_engineer_quotes` / `load_customer_quotes` — Data loading
- `accept_marketplace_job` — Engineer accepts a marketplace job
- `get_engineer_stripe_status` — Check Stripe Connect status
- `pay_invoice` / `record_payment` — Payment recording
- `save_mileage` — Mileage tracking
- `search_knowledge` — AI knowledge base search
- `toggle_like` / `create_social_post` / `add_comment` — Social features

### RLS policies added this project:
- `"Engineers can insert customers"` ON customers FOR INSERT — WITH CHECK that user exists in engineers table with status='approved'
- `"Engineers can update customers"` ON customers FOR UPDATE — same engineer check

---

## 6. EDGE FUNCTIONS (all ACTIVE)

| Function | Version | Purpose |
|----------|---------|---------|
| `create-checkout-session` | v21 | Creates Stripe Checkout session. Looks up engineer's custom rates from `engineers` table, passes `callout_fee` in metadata, safety bounds £15-£1000 |
| `stripe-webhook` | v24 | Handles Stripe webhook events. Verifies signatures (HMAC-SHA256, Web Crypto API). Reads `metadata.callout_fee` for dynamic pricing. Creates job in `marketplace_jobs` table on successful payment |
| `send-email` | v30 | Sends emails via Resend. Requires JWT auth for all types EXCEPT enquiry/enquiry_confirmation (which need apikey matching anon key). Has `esc()` HTML escape on ALL user data |
| `create-connect-account` | v22 | Creates/manages Stripe Connect Express accounts for engineers. SQL injection FIXED (no raw SQL, only parameterized Supabase .update() calls) |
| `moti-chat` | v14 | Moti AI chatbot (JWT required) |
| `moti-engineer` | v16 | Moti AI for engineers (JWT required) |
| `draft-outreach` | v2 | Sales outreach email drafting |
| `discover-leads` | v1 | Lead discovery |
| `research-lead` | v2 | Lead research |

### Stripe webhook events it listens for:
- `checkout.session.completed` — Creates marketplace job
- `account.updated` — Updates engineer Stripe Connect status
- `payment_intent.payment_failed` — Logs failure

### Critical: 16 metadata keys passed through the payment chain:
client app.html → create-checkout-session → Stripe → stripe-webhook. All 16 verified matching.

---

## 7. STRIPE CONFIGURATION

- **Mode**: LIVE (not test)
- **Live publishable key**: `pk_live_51TWnlLCEkS0MRxPAxycF1hGTfg1pl1VG9Dbnw3MRRW2GswZ22XvZUhyWhnT1ifORQGGtXjvaibW1g71kevXPetto00EY5jnTmS`
- **Model**: Stripe Connect Express with destination charges
- **Webhook URL**: `https://uphlvpatjhdnqcsytvaz.supabase.co/functions/v1/stripe-webhook`
- **STRIPE_WEBHOOK_SECRET**: Set in Supabase secrets (confirmed active)
- **Platform fee**: Fixed £15 per callout (`PLATFORM_FEE_FIXED`)

### Pricing helpers in app.html:
- `getEngRate(type)` — Returns engineer's rate (standard or emergency)
- `getEngShare(type)` — Returns engineer's share (rate minus £15 platform fee)
- `getCustRate(type, engId)` — Returns customer-facing rate for a specific engineer
- Default rates: £85 standard, £135 emergency (overridden by engineer's custom rates from DB)

---

## 8. TEST ACCOUNTS

| Role | Email | Name | User ID |
|------|-------|------|---------|
| Engineer | nrematco@gmail.com | ben maco | 7e5ead93-bfbd-436e-a3e4-cd04abf491d6 |
| Customer | njuemax28@gmail.com | njue Max | 0abd2768-727e-43db-9450-8ae83654bebd |
| Admin/Owner | njueephriam8@gmail.com | njue Ephriam | 6d4b600a-e9a0-43e8-9606-e0b74e102a52 |
| Engineer (Spencer) | tangspen2002@gmail.com | Spencer Tangzung | 91077ee6-faa0-464e-aa0d-e7ac16ca0557 |

### Spencer's business details:
- Gas Safe number: 641382
- Company No: 11357335
- Business: SPENCER GAS AND SERVICES LTD (trading as HomeLinq under Infinite Life Records Ltd)

---

## 9. KEY CODE PATTERNS & LOCATIONS IN app.html

### Security functions:
- **Line ~6096**: `escAttr()` — HTML attribute escaping
- **Line ~6097**: `esc()` — Full HTML escaping (& first to avoid double-encoding): `function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`
- **183 total** `esc()`/`escAttr()` calls across the file for XSS protection

### UUID handling:
- ALL IDs in `onclick` handlers MUST be quoted with escaped single quotes
- `genUUID()` function (~line 10147): Generates client-side UUIDs for engineer-created customers

### Email function:
- `sendHomeLinqEmail(to, subject, type, data, opts)` — Correct signature. Type 'generic' renders `data.message` as HTML body.

### Data persistence functions (~line 9945+):
- `saveJobToSupabase(job, dateKey)` → calls `sb.rpc('save_engineer_job', ...)`
- `saveInvoiceToSupabase(inv)` → calls `sb.rpc('send_invoice', ...)`
- `saveCertToSupabase(cert)` → calls `sb.rpc('save_certificate', ...)`
- `saveCustomerToSupabase(cust)` → generates UUID if needed, upserts to customers table
- Boiler passports: saved via `sb.rpc('save_boiler_passport', ...)` at line ~3167

### Certificate auto-save:
- `scheduleCertSave(ci)` — Debounced (2 second) auto-save on cert field changes
- 35 cert field `onchange` handlers call `scheduleCertSave()`

### Offline cache (localStorage):
- Strips PII before caching — customers mapped to `{id,name,ini,boiler,last,next,jobs,spent,c,isCompany}`
- `homelinq_shared_data` reduced to only `{engineer:{name,gasSafe,business},customers:_sharedCusts,faultChatLearned}`

### Invoice numbering:
- After invoice loading (~line 769), derives `nextInvNum` from highest existing invoice number to prevent collisions

### Payment flow:
- `processCalloutPayment()` — Initiates Stripe Checkout via edge function
- `processCalloutPaymentLocal()` — Honest "Payment Unavailable" screen (NOT a fake payment). Shows retry/cancel buttons. No jobs created without real Stripe payment.
- `checkStripeReturn()` — Handles redirect back from Stripe, fetches created job from Supabase

### Customer-facing features:
- `pgCustEngProfile()` (~line 4191) — Engineer profile page showing name, Gas Safe, rating, reviews, specialties, rates
- `loadPickableEngineers()` (~line 4211) — Loads approved engineers from Supabase with rates
- Engineer cards in customer browse view link to profile pages

### CSV Import (~line 9587):
- Customers imported via CSV now include all required fields: `ini, addr, boiler, last, next, jobs, spent, c, isCompany, hist`
- Also calls `saveCustomerToSupabase()` for each imported customer

---

## 10. SECURITY MEASURES IMPLEMENTED

1. **XSS protection**: 183 `esc()`/`escAttr()` calls on all user data in innerHTML
2. **SQL injection**: Removed `exec_sql` RPC from create-connect-account, uses only parameterized Supabase `.update()` calls
3. **Email auth**: send-email edge function requires JWT for all types except enquiry
4. **Stripe webhook verification**: HMAC-SHA256 signature verification using Web Crypto API
5. **RLS**: Enabled on all 37 tables
6. **No fake payments**: processCalloutPaymentLocal shows honest "unavailable" screen
7. **No test keys**: Only live Stripe key in production, no `pk_test_`, `sk_test_`, `localhost` references
8. **Invoice number collision prevention**: Derives next number from existing max
9. **localStorage PII stripping**: Cached data has sensitive fields removed
10. **Session keepalive**: Prevents silent auth expiry

---

## 11. WHAT WAS COMPLETED IN RECENT SESSIONS

### Critical security fixes (Tasks #20-26):
- Fixed send-email open relay (added auth)
- Added Stripe signature verification to webhook
- Fixed SQL injection in create-connect-account
- Added XSS escaping across entire app (139 esc() + 44 escAttr() calls)
- Fixed duplicate job creation and fake payment flow
- Fixed invoice number collisions
- Reduced localStorage data exposure

### Data persistence fixes (Tasks #32-35):
- Certificates now save to Supabase on creation, duplication, and field changes (with debounced auto-save)
- Customers created by engineers now save to Supabase (with new RLS policies allowing engineer INSERT/UPDATE)
- Invoices save to Supabase on manual creation (with correct date)
- Boiler passports save via RPC (was already wired up)

### Infrastructure:
- All edge functions verified deployed and active
- Full metadata chain verified (16 keys matching across payment flow)
- Service worker bumped to v14
- Deployed to Netlify via GitHub (auto-deploy on push)
- Fixed `save_engineer_job` RPC — added text→date cast for `scheduled_date` column
- Fixed customer CSV import crash (missing `spent`, `jobs`, `ini`, `hist` fields)

---

## 12. KNOWN ISSUES / PENDING WORK

1. **Deploy workflow**: Files are edited in HOMELI~1 but must be manually copied to the GitHub folder and pushed. A `deploy.bat` was suggested but may not be set up yet.

2. **Customer profile in customer app**: Engineer profiles exist and show rates, but:
   - Emergency/out-of-hours rate is NOT shown on the profile page (only standard callout)
   - Engineer cards in browse view don't show prices upfront (customer must tap into profile)

3. **SEO and Google Ads**: User requested this but work hasn't started yet.

4. **Latest fix may not be deployed yet**: The customer import crash fix (adding missing fields to CSV-imported customers) needs to be pushed to GitHub for Netlify to deploy it.

---

## 13. DEPLOYMENT CHECKLIST (for any future changes)

1. Make changes to files in `HOMELI~1/` folder
2. If app.html was changed, bump `moti-sw.js` cache version (currently v14, increment to v15, v16, etc.)
3. Copy files to GitHub folder: `xcopy "...\HOMELI~1\*" "...\GitHub\homelinq\" /E /Y`
4. Commit and push: `git add . && git commit -m "message" && git push`
5. Netlify auto-deploys within seconds
6. Tell users to clear browser cache (Ctrl+Shift+Delete) or hard refresh (Ctrl+Shift+R)

---

## 14. EXTERNAL SERVICES & CREDENTIALS

| Service | Purpose | Access |
|---------|---------|--------|
| Supabase | Database, Auth, Edge Functions, Storage | Dashboard: supabase.com (linked to GitHub) |
| Stripe | Payments (Connect Express) | Dashboard: dashboard.stripe.com |
| Netlify | Hosting & deployment | Dashboard: app.netlify.com/projects/homelinq |
| GitHub | Code repository | github.com/njueephriam/homelinq |
| Resend | Transactional email | Sending from noreply@homelinq.co.uk |
| postcodes.io | UK postcode lookup | Free, no key needed |
| Nominatim/OpenStreetMap | Street address autocomplete | Free, no key needed |

### Supabase secrets that must be set (in Edge Functions → Secrets):
- `STRIPE_SECRET_KEY` — Stripe live secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (whsec_...)
- `RESEND_API_KEY` — Resend email API key
- `SUPABASE_SERVICE_ROLE_KEY` — For edge functions that need admin access

---

## 15. HOW THE APP WORKS (user flows)

### Customer flow:
1. Customer visits homelinq.co.uk → signs up / logs in
2. Reports a problem (selects service type, describes issue, uploads photos)
3. Browses nearby engineers → views profiles with rates
4. Selects engineer → pays callout fee via Stripe Checkout
5. Stripe webhook creates job in `marketplace_jobs` table
6. Engineer gets notified → accepts job → schedules visit
7. Engineer completes work → auto-invoice generated
8. Customer receives invoice email with payment link
9. Boiler passport created/updated automatically

### Engineer flow:
1. Engineer signs up → completes onboarding wizard
2. Sets up Stripe Connect (for receiving payments)
3. Sets custom rates (standard + emergency callout)
4. Receives marketplace jobs → accepts → schedules
5. Completes job → fills in completion form (boiler details, findings, work done)
6. Invoice auto-generated and emailed to customer
7. CP12 certificates can be created and auto-saved
8. Customer management with invoice tracking and chase reminders
9. Mileage tracking, expense logging, daily notes

### Admin flow:
1. Admin dashboard (admin.html) with Sales CRM
2. Lead discovery and outreach tools
3. Engineer approval/management
