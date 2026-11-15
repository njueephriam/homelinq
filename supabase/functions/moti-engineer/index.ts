// ============================================================
// Moti — operational AI assistant for HomeLinq Pro engineers.
// Acts AS the logged-in engineer (their JWT); RLS scopes everything.
// Read tools run instantly; write tools return a proposal to confirm.
// v17: emails are sent with the engineer's own login (send-email requires an approved engineer)
// v18: import help — Moti can show an "Open import wizard" button (open_import signal); the chat 📎 opens the wizard
// v19: books — VAT choice on invoices, complete_job tool, HMRC categories + VAT on expenses, figures from get_books, every write tagged created_via='moti'
// v20: photos (Moti reads images), up to 6 proposals approved together (confirmActions), activity log (moti_activity), new tools:
//      log_job_expense, upsert_boiler_passport, save_imported_certificate, attach_photo_to_job, add_job_note
// v21: parts log — log_parts (receipt lines into the engineer's parts list) and find_part_prices (own prices + anonymous shared range)
// v22: check_online_prices — public prices from UK merchants' websites via the parts-finder function (same cache + daily limit)
// Secret required: ANTHROPIC_API_KEY
// Optional secrets for push: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-haiku-4-5-20251001";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DAILY_AI_CALLS = 300;
const MAX_IMAGE_B64 = 2200000; // ~1.6 MB image
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@homelinq.co.uk";

function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}

const READ_TOOLS = [
  { name: "list_jobs", description: "List the engineer's jobs, soonest first. Optional status filter.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["upcoming","in_progress","completed","cancelled"] }, limit: { type: "number" } } } },
  { name: "list_invoices", description: "List the engineer's invoices, newest first. Optional status filter.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["unpaid","paid","overdue","cancelled"] }, limit: { type: "number" } } } },
  { name: "list_quotes", description: "List the engineer's quotes, newest first.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "list_reminders", description: "List the engineer's service reminders, soonest due first.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "list_cp12", description: "List the engineer's CP12 gas safety certificates, soonest expiry first.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "list_boiler_passports", description: "List boiler passports. Optional text search on the address.",
    input_schema: { type: "object", properties: { search: { type: "string" }, limit: { type: "number" } } } },
  { name: "financial_summary", description: "The engineer's books between two dates (YYYY-MM-DD) — the same figures as the Accounting page: turnover (income received), expenses claimed by Self Assessment box, mileage allowance, platform fees, net profit, VAT charged and reclaimable, money owed. The UK tax year runs 6 April to 5 April.",
    input_schema: { type: "object", properties: { from_date: { type: "string" }, to_date: { type: "string" } }, required: ["from_date","to_date"] } },
  { name: "find_part_prices", description: "Search the engineer's own parts list (built from their receipts): what they paid per item before VAT, when and where, the cheapest supplier in the last year, and — only when at least 3 engineers have shared prices for that maker's part number — the anonymous typical price range. Use for 'what did I pay for…', 'where's cheapest for…', or to price a quote from real costs.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "part name, maker's part number or merchant code" } }, required: ["query"] } },
  { name: "check_online_prices", description: "Look up PUBLIC online prices for a part on UK merchants' websites (Screwfix, Toolstation, City Plumbing, Plumb Center, Wolseley, PlumbNation, BES, heating spares shops…). Takes up to a minute and uses one of the engineer's 30 daily checks (results are shared for 24 hours). Only use when the engineer asks where to buy, what it costs online/elsewhere, or asks you to check prices — not for every parts question. Give the maker's part number whenever you know it.",
    input_schema: { type: "object", properties: { name: { type: "string" }, manufacturer: { type: "string" }, part_number: { type: "string", description: "manufacturer's part number" } }, required: ["name"] } },
  { name: "open_import_wizard", description: "Show the engineer a button in this chat that opens HomeLinq's import wizard, to bring in customers, jobs, invoices, certificates and expenses from another system or spreadsheet. Use it whenever they want to import, migrate, move over from another platform or upload their records. Call it together with your reply.",
    input_schema: { type: "object", properties: {} } },
];

const WRITE_TOOLS = [
  { name: "create_invoice", description: "Create a new invoice (status: unpaid) for a customer. amount is the price BEFORE VAT. If the engineer is VAT-registered you must ask them which VAT rate to use (20%, 5% or no VAT) — never assume.",
    input_schema: { type: "object", properties: { customer_name: { type: "string" }, customer_email: { type: "string" }, description: { type: "string" }, amount: { type: "number", description: "price before VAT" }, vat_rate: { type: "number", enum: [0, 5, 20], description: "VAT-registered engineers only: the rate they chose" }, due_date: { type: "string" } }, required: ["customer_name","description","amount"] } },
  { name: "complete_job", description: "Complete one of the engineer's jobs the full way, exactly like the app: marks it completed, creates its invoice (job price plus billable parts), logs the mileage and sets the annual service reminder. Use the job id from list_jobs. If the engineer is VAT-registered, ask which VAT rate (20%, 5% or no VAT) first.",
    input_schema: { type: "object", properties: { job_id: { type: "string" }, customer_name: { type: "string" }, vat_rate: { type: "number", enum: [0, 5, 20] } }, required: ["job_id"] } },
  { name: "send_invoice", description: "Email an existing invoice to the customer. Use the invoice id from list_invoices.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" }, customer_name: { type: "string" } }, required: ["invoice_id"] } },
  { name: "chase_payment", description: "Send the customer a polite payment reminder for an unpaid invoice. Use the invoice id from list_invoices.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" }, customer_name: { type: "string" } }, required: ["invoice_id"] } },
  { name: "update_job_status", description: "Change the status of one of the engineer's jobs (upcoming, in progress or cancelled). To complete a job use complete_job instead.",
    input_schema: { type: "object", properties: { job_id: { type: "string" }, status: { type: "string", enum: ["upcoming","in_progress","completed","cancelled"] } }, required: ["job_id","status"] } },
  { name: "create_quote", description: "Create a draft quote for a customer.",
    input_schema: { type: "object", properties: { customer_name: { type: "string" }, diagnosis: { type: "string" }, parts_cost: { type: "number" }, labour_cost: { type: "number" } }, required: ["customer_name","diagnosis","parts_cost","labour_cost"] } },
  { name: "log_expense", description: "Log a general business expense in the engineer's books. amount is the total paid (including any VAT). Pick the HMRC category that fits: cogs = parts & materials, fuel, van = van costs, tools = tools & equipment, insurance, phone = phone & internet, clothing = workwear & PPE, training = training & CPD, office = office & admin, subscriptions, professional = accountant/legal/professional fees, other.",
    input_schema: { type: "object", properties: { date: { type: "string" }, description: { type: "string" }, amount: { type: "number" }, category: { type: "string", enum: ["cogs","fuel","van","tools","insurance","phone","clothing","training","office","subscriptions","professional","other"] }, vat: { type: "number", description: "VAT included in the amount, if the receipt shows it" } }, required: ["date","description","amount","category"] } },
  { name: "log_job_expense", description: "Log a cost against one of the engineer's jobs (parts, materials) — e.g. from a receipt photo. amount is the total paid including VAT. billable = re-charged to the customer (default true). Use the job id from list_jobs.",
    input_schema: { type: "object", properties: { job_id: { type: "string" }, customer_name: { type: "string" }, description: { type: "string" }, amount: { type: "number" }, vat: { type: "number" }, category: { type: "string", enum: ["cogs","fuel","van","tools","insurance","phone","clothing","training","office","subscriptions","professional","other"] }, billable: { type: "boolean" } }, required: ["job_id","description","amount"] } },
  { name: "upsert_boiler_passport", description: "Create or update the boiler passport for a property from a boiler data plate: make, model, serial number, GC number, fuel, output. Only include details you could actually read.",
    input_schema: { type: "object", properties: { address: { type: "string" }, postcode: { type: "string" }, house_number: { type: "string" }, boiler_make: { type: "string" }, boiler_model: { type: "string" }, serial_number: { type: "string" }, gc_number: { type: "string" }, fuel_type: { type: "string" }, output_kw: { type: "number" }, install_date: { type: "string" } }, required: ["address","boiler_make"] } },
  { name: "save_imported_certificate", description: "Save an old paper gas safety certificate (from a photo) as an IMPORTED, read-only record. It keeps the ORIGINAL engineer's name, Gas Safe number, dates and certificate number — it is never re-issued under this engineer. Only include details you could read.",
    input_schema: { type: "object", properties: { certificate_number: { type: "string" }, cert_type: { type: "string", enum: ["domestic","non_domestic","oil","warning","commissioning"] }, property_address: { type: "string" }, issue_date: { type: "string" }, expiry_date: { type: "string" }, landlord_name: { type: "string" }, tenant_name: { type: "string" }, original_engineer_name: { type: "string" }, original_gas_safe_number: { type: "string" }, result: { type: "string", enum: ["PASS","FAIL"] } }, required: ["property_address","issue_date"] } },
  { name: "attach_photo_to_job", description: "Keep the photo the engineer just sent, attached privately to a job (or as a receipt). Only when a photo was sent in this message.",
    input_schema: { type: "object", properties: { job_id: { type: "string" }, customer_name: { type: "string" }, kind: { type: "string", enum: ["receipt","data_plate","fault","site","certificate"] }, caption: { type: "string" } }, required: ["kind"] } },
  { name: "add_job_note", description: "Add a dated note to one of the engineer's jobs (e.g. what a photo shows, readings, advice given).",
    input_schema: { type: "object", properties: { job_id: { type: "string" }, customer_name: { type: "string" }, note: { type: "string" } }, required: ["job_id","note"] } },
  { name: "log_parts", description: "Add the parts bought on a receipt or merchant invoice to the engineer's parts list with the prices paid, so they can look prices up later and reuse them in quotes. unit_price is per item BEFORE VAT; vat is the VAT for that line. Include the maker's part number and the merchant's own code when printed.",
    input_schema: { type: "object", properties: { supplier: { type: "string" }, branch: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, job_id: { type: "string" },
      lines: { type: "array", maxItems: 40, items: { type: "object", properties: { name: { type: "string" }, manufacturer: { type: "string" }, part_number: { type: "string" }, supplier_code: { type: "string" }, qty: { type: "number" }, unit_price: { type: "number" }, vat: { type: "number" } }, required: ["name","unit_price"] } } }, required: ["supplier","lines"] } },
  { name: "log_mileage", description: "Log a mileage entry.",
    input_schema: { type: "object", properties: { date: { type: "string" }, miles: { type: "number" }, from_location: { type: "string" }, to_location: { type: "string" } }, required: ["date","miles"] } },
  { name: "create_reminder", description: "Create a service reminder for a customer.",
    input_schema: { type: "object", properties: { customer_name: { type: "string" }, service_type: { type: "string" }, due_date: { type: "string" }, message: { type: "string" } }, required: ["customer_name","service_type","due_date"] } },
  { name: "add_boiler_history", description: "Add a service or repair record to a boiler passport.",
    input_schema: { type: "object", properties: { passport_id: { type: "string" }, service_type: { type: "string" }, service_date: { type: "string" }, notes: { type: "string" } }, required: ["passport_id","service_type","service_date"] } },
];
const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
const EXP_CATS: Record<string, string> = { cogs: "Parts & Materials", fuel: "Fuel", van: "Van Costs", tools: "Tools & Equipment", insurance: "Insurance", phone: "Phone & Internet", clothing: "Workwear & PPE", training: "Training & CPD", office: "Office & Admin", subscriptions: "Subscriptions", professional: "Professional Fees", other: "Other" };
const VAT_RATES = [0, 5, 20];

// Rules a write must meet before it is shown to the engineer to confirm (and again when it runs)
function checkWrite(name: string, input: any, vatReg: boolean): string {
  if (name === "create_invoice" || name === "complete_job") {
    if (vatReg) {
      if (input.vat_rate === undefined || input.vat_rate === null || VAT_RATES.indexOf(Number(input.vat_rate)) === -1) return "The engineer is VAT-registered: ask them which VAT rate to use for this invoice (20%, 5% or no VAT) before going ahead.";
    } else { input.vat_rate = 0; }
  }
  if (name === "update_job_status" && input.status === "completed") return "To complete a job use the complete_job tool — it also creates the invoice, logs the mileage and sets the reminder.";
  if (name === "log_expense" && !EXP_CATS[input.category]) input.category = "other";
  if (name === "log_job_expense") { if (!EXP_CATS[input.category]) input.category = "cogs"; if (!vatReg) input.vat = 0; if (Number(input.vat) > Number(input.amount)) return "The VAT can't be more than the amount — check the receipt."; }
  if (name === "log_parts" && (!Array.isArray(input.lines) || !input.lines.length)) return "There are no parts to add — list each item with its price.";
  if (name === "save_imported_certificate" && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.issue_date || ""))) return "Give the issue date as YYYY-MM-DD (read it from the certificate), or ask the engineer.";
  return "";
}
const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

async function runRead(sb: any, name: string, input: any, token = "") {
  const lim = Math.min(Number(input?.limit) || 20, 50);
  try {
    if (name === "list_jobs") {
      let q = sb.from("jobs").select("id,job_number,customer_name,address,description,scheduled_date,scheduled_time,status,price,amount").order("scheduled_date", { ascending: true }).limit(lim);
      if (input.status) q = q.eq("status", input.status);
      const { data, error } = await q; return error ? { error: error.message } : data;
    }
    if (name === "list_invoices") {
      let q = sb.from("invoices").select("id,invoice_number,customer_name,customer_email,description,total,status,due_date,chase_count,created_at").order("created_at", { ascending: false }).limit(lim);
      if (input.status) q = q.eq("status", input.status);
      const { data, error } = await q; return error ? { error: error.message } : data;
    }
    if (name === "list_quotes") {
      const { data, error } = await sb.from("quotes").select("id,quote_number,customer_name,diagnosis,total,status,created_at").order("created_at", { ascending: false }).limit(lim);
      return error ? { error: error.message } : data;
    }
    if (name === "list_reminders") {
      const { data, error } = await sb.from("reminders").select("id,customer_name,service_type,due_date,status").order("due_date", { ascending: true }).limit(lim);
      return error ? { error: error.message } : data;
    }
    if (name === "list_cp12") {
      const { data, error } = await sb.from("cp12_certificates").select("id,certificate_number,property_address,landlord_name,issue_date,expiry_date,status").order("expiry_date", { ascending: true }).limit(lim);
      return error ? { error: error.message } : data;
    }
    if (name === "list_boiler_passports") {
      let q = sb.from("boiler_passports").select("id,address,postcode,boiler_make,boiler_model,status,last_service_date,next_due_date").limit(lim);
      if (input.search) q = q.ilike("address", "%" + input.search + "%");
      const { data, error } = await q; return error ? { error: error.message } : data;
    }
    if (name === "find_part_prices") {
      const { data, error } = await sb.rpc("find_parts", { p_query: String(input.query || "").slice(0, 80), p_limit: 8 });
      if (error) return { error: error.message };
      const out: any[] = [];
      for (const p of (data || [])) {
        let shared: any = null;
        if (String(p.match_key || "").indexOf("PN:") === 0) { const r = await sb.rpc("part_price_pool", { p_match_key: p.match_key }); shared = r.data || null; }
        out.push({ name: p.name, manufacturer: p.manufacturer, part_number: p.part_number, times_bought: p.times_bought, last: p.last, cheapest_last_12_months: p.cheapest, shared_range: shared });
      }
      return { parts: out, note: "All prices are per item, before VAT. shared_range is anonymous and only shown when 3+ engineers have prices." };
    }
    if (name === "check_online_prices") {
      const r = await fetch(SUPABASE_URL + "/functions/v1/parts-finder", { method: "POST", headers: { "Content-Type": "application/json", "apikey": ANON, "Authorization": "Bearer " + token },
        body: JSON.stringify({ name: String(input.name || "").slice(0, 160), manufacturer: String(input.manufacturer || "").slice(0, 60), part_number: String(input.part_number || "").slice(0, 60) }) });
      const d = await r.json().catch(() => ({ error: "Online price search isn't available right now." }));
      if (d.error) return { error: d.error };
      return { online_prices: (d.results || []).map((x: any) => ({ shop: x.shop, product: x.title, price: x.price, vat: x.vat === "inc" ? "inc VAT" : x.vat === "ex" ? "ex VAT" : "VAT not stated", before_vat: x.price_ex_vat, in_stock: x.in_stock, link: x.url, price_seen_on_page: x.seen_on_page })),
        finder_note: d.note || "", checked_at: d.checked_at, note: "PUBLIC online prices (not the engineer's trade prices). Tell them to confirm on the shop's site before buying." };
    }
    if (name === "financial_summary") {
      const { data, error } = await sb.rpc("get_books", { p_from: input.from_date, p_to: input.to_date, p_lines: false });
      if (error) return { error: error.message };
      return { period: data.period, basis: data.engineer && data.engineer.basis, vehicle_method: data.engineer && data.engineer.vehicle_method_effective, summary: data.summary,
        note: "boxes = Self Assessment (SA103F) expense boxes. Figures are an estimate for the engineer's records, not a tax return." };
    }
  } catch (e) { return { error: String(e) }; }
  return { error: "unknown read tool" };
}

// Sends with the engineer's own login so send-email can confirm they are an approved engineer
async function sendEmail(payload: any, token: string): Promise<boolean> {
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": ANON, "Authorization": "Bearer " + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error("send-email failed:", r.status, await r.text());
    return r.ok;
  } catch (_e) { return false; }
}

async function runWrite(sb: any, engineerId: string, engName: string, token: string, name: string, input: any, vatReg: boolean) {
  try {
    const problem = checkWrite(name, input, vatReg);
    if (problem) return { error: problem };
    if (name === "create_invoice") {
      const net = Math.round(Number(input.amount) * 100) / 100;
      const rate = Number(input.vat_rate) || 0;
      const vat = Math.round(net * rate) / 100;
      const { data, error } = await sb.from("invoices").insert({ engineer_id: engineerId, customer_name: input.customer_name, customer_email: input.customer_email || null, description: input.description, amount: net, vat: vat, vat_rate: rate, total: Math.round((net + vat) * 100) / 100, status: "unpaid", due_date: input.due_date || null, created_via: "moti" }).select("id,invoice_number,customer_name,total,status").single();
      return error ? { error: error.message } : { created: "invoice", ...data };
    }
    if (name === "complete_job") {
      const { data, error } = await sb.rpc("complete_job", { p_job_id: input.job_id, p_vat_rate: vatReg ? Number(input.vat_rate) : null, p_via: "moti" });
      if (error) return { error: String(error.message || "").replace(/^VAT_CHOICE_REQUIRED: /, "") };
      return { completed: "job", customer_name: input.customer_name || "", invoice_number: data.invoice_number, total: data.total, already_invoiced: data.already_invoiced };
    }
    if (name === "send_invoice") {
      const { data: inv, error: ie } = await sb.from("invoices").select("*").eq("id", input.invoice_id).single();
      if (ie || !inv) return { error: "I couldn't find that invoice." };
      if (!inv.customer_email) return { error: "That invoice has no customer email saved, so I can't send it. Add the email to the invoice first." };
      const ok = await sendEmail({ to: inv.customer_email, subject: "Invoice " + (inv.invoice_number || "") + " from " + engName, type: "invoice", from_name: engName,
        data: { invoice_id: inv.invoice_number || inv.id, engineer_name: engName, customer_name: inv.customer_name, amount: inv.amount, total: inv.total, vat: inv.vat, vat_inclusive: Number(inv.vat || 0) > 0, description: inv.description, due_date: inv.due_date } }, token);
      if (!ok) return { error: "The invoice email didn't go through just then. Please try again shortly." };
      await sb.from("invoices").update({ sent_date: new Date().toISOString() }).eq("id", inv.id);
      return { sent: "invoice", to: inv.customer_email, customer: inv.customer_name, total: inv.total };
    }
    if (name === "chase_payment") {
      const { data: inv, error: ie } = await sb.from("invoices").select("*").eq("id", input.invoice_id).single();
      if (ie || !inv) return { error: "I couldn't find that invoice." };
      if (inv.status === "paid") return { error: "That invoice is already marked as paid — no need to chase it." };
      if (!inv.customer_email) return { error: "That invoice has no customer email saved, so I can't send a reminder." };
      const ok = await sendEmail({ to: inv.customer_email, subject: "Payment reminder — invoice " + (inv.invoice_number || ""), type: "invoice_reminder", from_name: engName,
        data: { invoice_id: inv.invoice_number || "", engineer_name: engName, customer_name: inv.customer_name, description: inv.description, total: inv.total } }, token);
      if (!ok) return { error: "The reminder didn't go through just then. Please try again shortly." };
      const n = Number(inv.chase_count || 0) + 1;
      await sb.from("invoices").update({ chase_count: n, last_chase_date: new Date().toISOString() }).eq("id", inv.id);
      return { chased: "invoice", to: inv.customer_email, customer: inv.customer_name, chase_count: n };
    }
    if (name === "update_job_status") {
      const { data, error } = await sb.from("jobs").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", input.job_id).select("id,job_number,customer_name,status").single();
      return error ? { error: error.message } : (data ? { updated: "job", ...data } : { error: "No job found with that id for you." });
    }
    if (name === "create_quote") {
      const total = Number(input.parts_cost) + Number(input.labour_cost);
      const { data, error } = await sb.from("quotes").insert({ engineer_id: engineerId, customer_name: input.customer_name, diagnosis: input.diagnosis, parts_cost: input.parts_cost, labour_cost: input.labour_cost, total: total, status: "draft", created_via: "moti" }).select("id,quote_number,customer_name,total,status").single();
      return error ? { error: error.message } : { created: "quote", ...data };
    }
    if (name === "log_expense") {
      const { data, error } = await sb.from("general_expenses").insert({ engineer_id: engineerId, date: input.date, description: input.description, amount: input.amount, category: input.category, category_label: EXP_CATS[input.category] || "Other", vat: vatReg ? (Number(input.vat) || 0) : 0, created_via: "moti" }).select("id,date,description,amount").single();
      return error ? { error: error.message } : { created: "expense", ...data };
    }
    if (name === "log_job_expense") {
      const amt = Math.round(Number(input.amount) * 100) / 100, vat = vatReg ? Math.round((Number(input.vat) || 0) * 100) / 100 : 0;
      const { data, error } = await sb.from("job_expenses").insert({ job_id: input.job_id, description: input.description, amount: amt, vat: vat, billable: input.billable !== false, hmrc_category: input.category || "cogs", sa103_box: "Box " + (input.category === "fuel" || input.category === "van" ? 20 : input.category === "cogs" || !input.category ? 17 : 30), created_via: "moti" }).select("id,description,amount").single();
      return error ? { error: error.message } : { created: "job expense", ...data, _table: "job_expenses" };
    }
    if (name === "upsert_boiler_passport") {
      const pc = String(input.postcode || "").toUpperCase().trim();
      let found: any = null;
      if (input.serial_number) { const r = await sb.from("boiler_passports").select("id").eq("serial_number", input.serial_number).limit(1).maybeSingle(); found = r.data; }
      if (!found && pc) { const r = await sb.from("boiler_passports").select("id,address").eq("postcode", pc).ilike("address", "%" + String(input.address || "").split(",")[0].trim() + "%").limit(1).maybeSingle(); found = r.data; }
      const fields: any = {};
      ["boiler_make","boiler_model","serial_number","gc_number","fuel_type","install_date","house_number"].forEach((k) => { if (input[k]) fields[k] = String(input[k]).slice(0, 120); });
      if (input.output_kw) fields.output_kw = Number(input.output_kw) || null;
      if (found) {
        const { error } = await sb.from("boiler_passports").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", found.id);
        return error ? { error: error.message } : { updated: "boiler passport", id: found.id, _table: "boiler_passports" };
      }
      const { data, error } = await sb.from("boiler_passports").insert({ address: input.address, postcode: pc || null, ...fields, status: "active" }).select("id").single();
      return error ? { error: error.message } : { created: "boiler passport", id: data.id, _table: "boiler_passports" };
    }
    if (name === "save_imported_certificate") {
      const orig = String(input.certificate_number || "").trim();
      const num = "IMP-" + (orig || ("PHOTO-" + Date.now().toString(36).toUpperCase()));
      const issue = input.issue_date; let exp = input.expiry_date;
      if (!exp || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) { const d = new Date(issue + "T12:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 1); exp = d.toISOString().slice(0, 10); }
      const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const status = exp < today ? "expired" : (exp < soon ? "expiring_soon" : "valid");
      const res = String(input.result || "PASS").toUpperCase();
      const { data, error } = await sb.from("cp12_certificates").insert({ engineer_id: engineerId, certificate_number: num, cert_type: input.cert_type || "domestic", property_address: input.property_address,
        landlord_name: input.landlord_name || "", tenant_name: input.tenant_name || "", issue_date: issue, expiry_date: exp, status, inspection_result: res, appliances: [],
        engineer_name: input.original_engineer_name || "", gas_safe_number: input.original_gas_safe_number || "",
        data: { importedRecord: true, fromPhoto: true, originalNumber: orig, originalEngineer: input.original_engineer_name || "", originalGasSafe: input.original_gas_safe_number || "",
          recipientName: input.landlord_name || input.tenant_name || "", recipientType: "landlord", prop: input.property_address, date: issue, expiry: exp, result: res, sent: false } }).select("id,certificate_number").single();
      if (error) return { error: error.message };
      if (exp >= today) await sb.from("reminders").insert({ engineer_id: engineerId, customer_name: input.landlord_name || input.property_address, service_type: "Gas safety check (CP12)", due_date: exp, message: "Gas safety certificate due for " + input.property_address, status: "scheduled" });
      return { created: "imported certificate", id: data.id, certificate_number: data.certificate_number, expiry: exp, _table: "cp12_certificates" };
    }
    if (name === "attach_photo_to_job") {
      const path = String(input.storage_path || ""), bucket = input.storage_bucket === "receipts" ? "receipts" : "job-photos";
      if (!path || path.indexOf(engineerId + "/") !== 0) return { error: "The photo hasn't been uploaded yet — please try again." };
      const { data, error } = await sb.from("job_photos").insert({ engineer_id: engineerId, job_id: input.job_id || null, storage_bucket: bucket, storage_path: path, caption: String(input.caption || "").slice(0, 300), kind: input.kind || "site", created_via: "moti" }).select("id").single();
      return error ? { error: error.message } : { attached: "photo", id: data.id, _table: "job_photos" };
    }
    if (name === "add_job_note") {
      const { data: j, error: je } = await sb.from("jobs").select("id,notes").eq("id", input.job_id).single();
      if (je || !j) return { error: "I couldn't find that job." };
      const stamp = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" });
      const notes = (j.notes ? j.notes + "\n" : "") + "[" + stamp + " · Moti] " + String(input.note || "").slice(0, 1000);
      const { error } = await sb.from("jobs").update({ notes, updated_at: new Date().toISOString() }).eq("id", j.id);
      return error ? { error: error.message } : { noted: "job", id: j.id, _table: "jobs" };
    }
    if (name === "log_parts") {
      const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 40).map((l: any) => ({ name: String(l.name || "").slice(0, 200), manufacturer: l.manufacturer || "", part_number: l.part_number || "", supplier_code: l.supplier_code || "", qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0, vat: vatReg ? (Number(l.vat) || 0) : 0 }));
      const { data, error } = await sb.rpc("log_part_purchase", { p_supplier: input.supplier, p_branch: input.branch || "", p_bought_on: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? input.date : new Date().toISOString().slice(0, 10),
        p_lines: lines, p_job_id: /^[0-9a-f-]{36}$/i.test(String(input.job_id || "")) ? input.job_id : null, p_source: "moti" });
      return error ? { error: error.message } : { logged: data.logged, supplier: input.supplier, _table: "part_prices" };
    }
    if (name === "log_mileage") {
      const { data, error } = await sb.from("mileage_log").insert({ engineer_id: engineerId, date: input.date, miles: input.miles, from_location: input.from_location || null, to_location: input.to_location || null, created_via: "moti" }).select("id,date,miles").single();
      return error ? { error: error.message } : { created: "mileage", ...data };
    }
    if (name === "create_reminder") {
      const { data, error } = await sb.from("reminders").insert({ engineer_id: engineerId, customer_name: input.customer_name, service_type: input.service_type, due_date: input.due_date, message: input.message || null, status: "scheduled" }).select("id,customer_name,service_type,due_date").single();
      return error ? { error: error.message } : { created: "reminder", ...data };
    }
    if (name === "add_boiler_history") {
      const { data, error } = await sb.from("boiler_history").insert({ passport_id: input.passport_id, engineer_id: engineerId, service_type: input.service_type, service_date: input.service_date, notes: input.notes || null, status: "good" }).select("id,service_type,service_date").single();
      return error ? { error: error.message } : { created: "boiler history record", ...data };
    }
  } catch (e) { return { error: String(e) }; }
  return { error: "unknown write tool" };
}

function summarise(tool: string, input: any): string {
  if (tool === "create_invoice") { const r = Number(input.vat_rate) || 0; const net = Number(input.amount) || 0; return "Create an invoice for " + input.customer_name + " — \"" + input.description + "\" — £" + net.toFixed(2) + (r ? " + " + r + "% VAT = £" + (Math.round(net * (100 + r)) / 100).toFixed(2) : " (no VAT)") + (input.due_date ? ", due " + input.due_date : ""); }
  if (tool === "complete_job") return "Complete the job" + (input.customer_name ? " for " + input.customer_name : "") + " — create its invoice" + (Number(input.vat_rate) ? " with " + input.vat_rate + "% VAT" : "") + ", log the mileage and set the annual reminder";
  if (tool === "send_invoice") return "Email this invoice to " + (input.customer_name || "the customer");
  if (tool === "chase_payment") return "Send a payment reminder to " + (input.customer_name || "the customer");
  if (tool === "update_job_status") return "Set job " + input.job_id + " to \"" + input.status + "\"";
  if (tool === "create_quote") return "Create a draft quote for " + input.customer_name + " — £" + (Number(input.parts_cost) + Number(input.labour_cost)) + " (parts £" + input.parts_cost + " + labour £" + input.labour_cost + ")";
  if (tool === "log_expense") return "Log an expense — \"" + input.description + "\" — £" + input.amount + " on " + input.date + " (" + (EXP_CATS[input.category] || "Other") + ")";
  if (tool === "log_mileage") return "Log " + input.miles + " miles on " + input.date;
  if (tool === "log_parts") { const ls = Array.isArray(input.lines) ? input.lines : []; return "Add " + ls.length + " part" + (ls.length === 1 ? "" : "s") + " from " + input.supplier + " to your parts list (" + ls.slice(0, 2).map((l: any) => l.name + " £" + Number(l.unit_price || 0).toFixed(2)).join(", ") + (ls.length > 2 ? ", …" : "") + ")"; }
  if (tool === "log_job_expense") return "Log £" + Number(input.amount || 0).toFixed(2) + (Number(input.vat) ? " (VAT £" + Number(input.vat).toFixed(2) + ")" : "") + " — \"" + input.description + "\" to the job" + (input.customer_name ? " for " + input.customer_name : "") + (input.billable === false ? " (not re-charged)" : "");
  if (tool === "upsert_boiler_passport") return "Save the boiler details (" + [input.boiler_make, input.boiler_model].filter(Boolean).join(" ") + (input.gc_number ? ", GC " + input.gc_number : "") + (input.serial_number ? ", serial " + input.serial_number : "") + ") to the boiler passport for " + input.address;
  if (tool === "save_imported_certificate") return "Save the old certificate" + (input.certificate_number ? " " + input.certificate_number : "") + " for " + input.property_address + " as an imported record (issued " + input.issue_date + (input.original_engineer_name ? " by " + input.original_engineer_name : "") + ") and set the renewal reminder";
  if (tool === "attach_photo_to_job") return "Keep this photo" + (input.kind === "receipt" ? " as a receipt" : "") + (input.customer_name ? " on the job for " + input.customer_name : (input.job_id ? " on the job" : "")) + (input.caption ? " — \"" + input.caption + "\"" : "");
  if (tool === "add_job_note") return "Add a note to the job" + (input.customer_name ? " for " + input.customer_name : "") + ": \"" + String(input.note || "").slice(0, 120) + "\"";
  if (tool === "create_reminder") return "Create a \"" + input.service_type + "\" reminder for " + input.customer_name + ", due " + input.due_date;
  if (tool === "add_boiler_history") return "Add a \"" + input.service_type + "\" record to a boiler passport (" + input.service_date + ")";
  return "Carry out this action";
}

function pushMessageFor(tool: string, r: any): string {
  if (tool === "create_invoice") return "Invoice created for " + (r.customer_name || "your customer") + (r.total != null ? " — £" + r.total : "");
  if (tool === "send_invoice") return "Invoice emailed to " + (r.customer || "your customer") + (r.total != null ? " (£" + r.total + ")" : "");
  if (tool === "complete_job") return "Job completed" + (r.invoice_number ? " — invoice " + r.invoice_number : "") + (r.total != null ? " (£" + r.total + ")" : "");
  if (tool === "chase_payment") return "Payment reminder sent to " + (r.customer || "your customer");
  if (tool === "update_job_status") return "Job " + (r.job_number || "") + " set to \"" + (r.status || "updated") + "\"";
  if (tool === "create_quote") return "Quote drafted for " + (r.customer_name || "your customer") + (r.total != null ? " — £" + r.total : "");
  if (tool === "log_expense") return "Expense logged" + (r.amount != null ? " — £" + r.amount : "");
  if (tool === "log_mileage") return "Mileage logged" + (r.miles != null ? " — " + r.miles + " miles" : "");
  if (tool === "log_parts") return "Added " + (r.logged || 0) + " part(s) to your parts list";
  if (tool === "create_reminder") return "Service reminder set for " + (r.customer_name || "your customer");
  if (tool === "add_boiler_history") return "Boiler passport updated";
  return "Moti finished the task you asked for.";
}

const TOOL_TABLE: Record<string, string> = { create_invoice: "invoices", complete_job: "invoices", send_invoice: "invoices", chase_payment: "invoices", update_job_status: "jobs", create_quote: "quotes", log_expense: "general_expenses", log_job_expense: "job_expenses", log_mileage: "mileage_log", create_reminder: "reminders", add_boiler_history: "boiler_history", upsert_boiler_passport: "boiler_passports", save_imported_certificate: "cp12_certificates", attach_photo_to_job: "job_photos", add_job_note: "jobs", log_parts: "part_prices" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function recordIdFor(tool: string, input: any, r: any): string | null {
  const c = [r && r.id, tool === "send_invoice" || tool === "chase_payment" ? input.invoice_id : null, tool === "update_job_status" ? input.job_id : null];
  for (const x of c) if (x && UUID_RE.test(String(x))) return String(x);
  return null;
}
function amountFor(tool: string, input: any, r: any): number | null {
  if (["create_invoice","complete_job","send_invoice","chase_payment"].indexOf(tool) !== -1 && r && r.total != null) return Number(r.total) || null;
  if (tool === "log_expense" || tool === "log_job_expense") return Number(input.amount) || null;
  if (tool === "create_quote" && r && r.total != null) return Number(r.total) || null;
  return null;
}

async function sendPush(sb: any, title: string, bodyText: string): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  try {
    const { data } = await sb.from("push_subscriptions").select("id,subscription");
    if (!data || !data.length) return;
    const mod: any = await import("npm:web-push@3.6.7");
    const webpush: any = mod.default || mod;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    const payload = JSON.stringify({ title, body: bodyText, url: "moti.html" });
    for (const row of data) {
      try {
        await webpush.sendNotification(row.subscription, payload);
      } catch (err: any) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          await sb.from("push_subscriptions").delete().eq("id", row.id);
        }
      }
    }
  } catch (_e) {
    console.error("push send skipped:", _e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "You need to be signed in to HomeLinq Pro for this." }, 401);

    const sb = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: ud, error: uerr } = await sb.auth.getUser();
    if (uerr || !ud?.user) return json({ error: "Your session has expired — please refresh the page and sign in again." }, 401);
    const engineerId = ud.user.id;

    const { data: eng } = await sb.from("engineers").select("full_name,business_name,vat_registered").eq("id", engineerId).maybeSingle();
    const vatReg = !!(eng && eng.vat_registered);
    const engName = (eng && eng.full_name) ? eng.full_name : "the engineer";
    const firstName = engName.split(" ")[0];

    const body = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const source = (body.image || body.source === "photo") ? "photo" : "chat";
    async function logAct(rows: any[]) {
      if (!rows.length) return;
      const { error } = await admin.from("moti_activity").insert(rows.map((r) => ({ engineer_id: engineerId, source, ...r })));
      if (error) console.error("activity log error:", error.message);
    }

    // Proposals the engineer turned down
    if (Array.isArray(body.declined) && body.declined.length) {
      await logAct(body.declined.slice(0, 6).filter((p: any) => p && WRITE_NAMES.has(p.tool)).map((p: any) => ({ kind: "declined", tool: p.tool, summary: summarise(p.tool, p.input || {}).slice(0, 500) })));
      if (!body.confirmActions && !body.confirmAction && !body.message && !body.image) return json({ ok: true });
    }

    // Approve one or several actions (each runs on its own; one failing doesn't stop the rest)
    const toRun: any[] = Array.isArray(body.confirmActions) ? body.confirmActions.slice(0, 6) : (body.confirmAction && body.confirmAction.tool ? [body.confirmAction] : []);
    if (toRun.length) {
      const results: any[] = [], acts: any[] = [], pushes: string[] = [];
      for (const a of toRun) {
        if (!a || !WRITE_NAMES.has(a.tool)) { results.push({ ok: false, message: "Unknown action." }); continue; }
        const input = a.input || {};
        const summary = summarise(a.tool, input).slice(0, 500);
        const r: any = await runWrite(sb, engineerId, engName, token, a.tool, input, vatReg);
        if (r.error) {
          results.push({ ok: false, tool: a.tool, message: "That didn't go through: " + r.error });
          acts.push({ kind: "failed", tool: a.tool, summary, record_table: TOOL_TABLE[a.tool] || null, detail: { error: String(r.error).slice(0, 300) } });
          continue;
        }
        const msg = pushMessageFor(a.tool, r);
        results.push({ ok: true, tool: a.tool, message: msg, result: r });
        acts.push({ kind: "done", tool: a.tool, summary, record_table: r._table || TOOL_TABLE[a.tool] || null, record_id: recordIdFor(a.tool, input, r), amount: amountFor(a.tool, input, r) });
        pushes.push(msg);
      }
      await logAct(acts);
      if (pushes.length) await sendPush(sb, "Moti — " + (pushes.length > 1 ? pushes.length + " tasks done" : "task done"), pushes.join(" · ").slice(0, 300));
      if (body.confirmAction && !body.confirmActions) { const r0 = results[0]; return json(r0.ok ? { done: true, message: "Done.", result: r0.result } : { done: false, message: r0.message }); }
      return json({ done: results.every((x) => x.ok), results });
    }

    if (!body.message && !body.image) return json({ error: "No message provided." }, 400);
    let image: any = null;
    if (body.image) {
      const mt = String(body.image.media_type || ""), data = String(body.image.data || "");
      if (["image/jpeg","image/png","image/webp"].indexOf(mt) === -1 || !data || data.length > MAX_IMAGE_B64) return json({ error: "I couldn't read that photo — please try again (JPEG or PNG, under 1.5 MB)." }, 400);
      image = { type: "image", source: { type: "base64", media_type: mt, data } };
      const { data: n, error: ue } = await admin.rpc("bump_moti_import_usage", { p_engineer: engineerId });
      if (!ue && Number(n) > DAILY_AI_CALLS) return json({ error: "You've reached today's fair-use limit for photos — I'll be able to look at photos again tomorrow. You can still type to me." }, 429);
    }
    const today = new Date().toISOString().slice(0, 10);
    const system = [
      "You are Moti, the operational AI assistant inside HomeLinq Pro. You help a Gas Safe engineer run their business.",
      "You are assisting " + engName + ((eng && eng.business_name) ? " of " + eng.business_name : "") + ". Address them by their first name, " + firstName + ", warmly and naturally — not in every message, just where it feels natural.",
      "Today is " + today + ". All money is in GBP (use the £ sign).",
      "Use the tools to look up the engineer's real jobs, invoices, quotes, finances, reminders, CP12 certificates and boiler passports. Never guess figures or invent data — if you need data, call a tool.",
      "You can create invoices, complete jobs (which invoices them, logs mileage and sets the annual reminder), email invoices to customers, send polite payment-chase reminders and log expenses — offer these naturally when they would help.",
      "MONEY & VAT: " + firstName + (vatReg ? " IS VAT-registered — for every invoice or job completion you must ask which VAT rate to use (20%, 5% or no VAT); never assume." : " is not VAT-registered — invoices have no VAT.") + " Everything you create goes into their books (Accounting page) exactly like work done in the app. For figures, use financial_summary — never add things up yourself. Log expenses with the right HMRC category. Tax figures are estimates; HomeLinq does not file with HMRC.",
      "PHOTOS: when the engineer sends a photo, say briefly what you can actually see and read — never guess hidden, cut-off or blurry details; say plainly what you can't read and ask for a clearer photo if needed. Data plate → propose upsert_boiler_passport for the property (use list_jobs to find today's job address if they don't say). Fault code on a display → explain what that code generally indicates for that make/model and sensible checks, clearly as general guidance to confirm against the manufacturer's manual; offer a quote if parts are likely. Receipt or merchant invoice → read supplier, date, items, VAT and total; propose log_job_expense for the job it belongs to (check list_jobs) or log_expense for a general business cost, and also propose log_parts so each item and its price goes into their parts list. Old paper gas safety certificate → propose save_imported_certificate, keeping the ORIGINAL engineer's name, Gas Safe number, dates and certificate number. When something is worth keeping, also propose attach_photo_to_job. Don't repeat customers' personal details from photos more than needed.",
      "SAFETY: never state whether an installation is safe or unsafe, and never classify it (Immediately Dangerous / At Risk / Not to Current Standards). That is " + firstName + "'s professional judgement under the Gas Industry Unsafe Situations Procedure. You may point out what you can see (e.g. corrosion, staining, a damaged flue) and suggest they check it.",
      "PARTS & PRICES: when asked what something costs, where it's cheapest, or to price a job, call find_part_prices first. Quote their own recent prices (per item, before VAT) with supplier and date; mention the anonymous shared range only when it is provided. Never invent prices. If they ask where to buy or what it costs online, call check_online_prices (it takes up to a minute — say you're checking) and lay it out as: their own last price → other engineers' range (if any) → public online prices, cheapest first, with shop, price and whether it's inc/ex VAT. Online prices are public, not trade prices — say to confirm on the shop's site. If the finder's note says the part number looks wrong, tell them.",
      "SEVERAL ACTIONS: you may propose up to 6 changes at once by calling several tools in one reply — the engineer ticks the ones they want and approves them together.",
      "IMPORTING DATA: when the engineer wants to bring their records over from another platform (Commusoft, Gas Engineer Software, Tradify, Joblogic, ServiceM8, BigChange) or from spreadsheets, call open_import_wizard so a button appears, and explain briefly: they export their customers, jobs, invoices, certificates and expenses as CSV or Excel from the old system, then tap the paperclip in this chat (or Settings → Import Data → Start import) and attach the files — several at once is fine. Inside the import, you (Moti) read the files with them: you work out which system and what each file is, match the columns, spot problems and link invoices and jobs to the right customers, and they approve every change. Then they review every row (problems, duplicates, totals) before anything is saved; old invoices are never emailed or chased; imported certificates keep the original engineer's details; and they can undo an import afterwards. Customers' personal details stay on their device — you only see column headings and patterns. You cannot read files inside this chat itself — always point to the import.",
      "For anything that CHANGES data or sends an email, just call the matching tool. The system automatically pauses and asks " + firstName + " to confirm before it commits — so you do NOT need to ask 'shall I?' yourself, and never claim something is done unless a tool result confirms it.",
      "IMPORTANT: You CANNOT accept jobs from the marketplace — there is deliberately no tool for that. Accepting marketplace work must always be the engineer's own decision. If they ask you to, explain warmly that they need to accept it themselves in the Marketplace section of HomeLinq Pro — but you are happy to help with everything once a job is theirs.",
      "Be warm, brief and plain-spoken. British English. Keep replies short; when listing things, keep them tidy and scannable.",
    ].join("\n");

    const messages: any[] = Array.isArray(body.history) ? body.history.slice(-12) : [];
    messages.push({ role: "user", content: image ? [image, { type: "text", text: String(body.message || "What can you see in this photo? Tell me what I could do with it.").slice(0, 4000) }] : String(body.message).slice(0, 4000) });

    for (let i = 0; i < 6; i++) {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: image ? 1600 : 1024, system, tools: ALL_TOOLS, messages }),
      });
      if (!aiRes.ok) { console.error("Claude error:", await aiRes.text()); return json({ error: "AI temporarily unavailable." }, 502); }
      const ai = await aiRes.json();
      const content = ai.content || [];
      const textPart = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

      if (ai.stop_reason !== "tool_use") {
        return json({ reply: textPart || "I'm not sure how to help with that one." });
      }
      if (content.some((b: any) => b.type === "tool_use" && b.name === "open_import_wizard")) {
        return json({ reply: textPart || "Happy to help you bring your data over. Tap the button below (or the paperclip) and attach the files you exported from your old system — I'll go through them with you, and you'll check every row before anything is saved.", open_import: true });
      }
      const writeBlocks = content.filter((b: any) => b.type === "tool_use" && WRITE_NAMES.has(b.name)).slice(0, 6);
      const problems = writeBlocks.map((b: any) => checkWrite(b.name, b.input || {}, vatReg));
      if (writeBlocks.length && problems.some((p: string) => p)) {
        // Not ready to propose yet (e.g. VAT rate not chosen) — tell Moti so it asks the engineer
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: content.filter((b: any) => b.type === "tool_use").map((b: any) => {
          const i = writeBlocks.indexOf(b), p = i >= 0 ? problems[i] : "";
          return { type: "tool_result", tool_use_id: b.id, is_error: !!p, content: p ? JSON.stringify({ error: p }) : JSON.stringify({ note: "Not run yet — propose it again together with the corrected action if still needed." }) };
        }) });
        continue;
      }
      if (writeBlocks.length) {
        const proposals = writeBlocks.map((b: any) => ({ tool: b.name, input: b.input, summary: summarise(b.name, b.input) }));
        await logAct(proposals.map((p: any) => ({ kind: "proposed", tool: p.tool, summary: String(p.summary).slice(0, 500) })));
        return json({ reply: textPart, proposal: proposals[0], proposals });
      }
      messages.push({ role: "assistant", content });
      const results: any[] = [];
      for (const b of content) {
        if (b.type === "tool_use") {
          const r = await runRead(sb, b.name, b.input || {}, token);
          results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r).slice(0, 6000) });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return json({ reply: "That took more steps than I expected — could you try asking a simpler way?" });
  } catch (e) {
    console.error("moti-engineer error:", e);
    return json({ error: "Something went wrong." }, 500);
  }
});
