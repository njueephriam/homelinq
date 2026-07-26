// ============================================================
// Moti — operational AI assistant for HomeLinq Pro engineers.
// Acts AS the logged-in engineer (their JWT); RLS scopes everything.
// Read tools run instantly; write tools return a proposal to confirm.
// Secret required: ANTHROPIC_API_KEY
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
  { name: "financial_summary", description: "Totals of paid and outstanding invoices, expenses and mileage between two dates (YYYY-MM-DD).",
    input_schema: { type: "object", properties: { from_date: { type: "string" }, to_date: { type: "string" } }, required: ["from_date","to_date"] } },
];

const WRITE_TOOLS = [
  { name: "create_invoice", description: "Create a new invoice (status: unpaid) for a customer.",
    input_schema: { type: "object", properties: { customer_name: { type: "string" }, customer_email: { type: "string" }, description: { type: "string" }, amount: { type: "number" }, due_date: { type: "string" } }, required: ["customer_name","description","amount"] } },
  { name: "send_invoice", description: "Email an existing invoice to the customer. Use the invoice id from list_invoices.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" }, customer_name: { type: "string" } }, required: ["invoice_id"] } },
  { name: "chase_payment", description: "Send the customer a polite payment reminder for an unpaid invoice. Use the invoice id from list_invoices.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" }, customer_name: { type: "string" } }, required: ["invoice_id"] } },
  { name: "update_job_status", description: "Change the status of one of the engineer's jobs.",
    input_schema: { type: "object", properties: { job_id: { type: "string" }, status: { type: "string", enum: ["upcoming","in_progress","completed","cancelled"] } }, required: ["job_id","status"] } },
  { name: "create_quote", description: "Create a draft quote for a customer.",
    input_schema: { type: "object", properties: { customer_name: { type: "string" }, diagnosis: { type: "string" }, parts_cost: { type: "number" }, labour_cost: { type: "number" } }, required: ["customer_name","diagnosis","parts_cost","labour_cost"] } },
  { name: "log_expense", description: "Log a general business expense.",
    input_schema: { type: "object", properties: { date: { type: "string" }, description: { type: "string" }, amount: { type: "number" }, category: { type: "string" } }, required: ["date","description","amount"] } },
  { name: "log_mileage", description: "Log a mileage entry.",
    input_schema: { type: "object", properties: { date: { type: "string" }, miles: { type: "number" }, from_location: { type: "string" }, to_location: { type: "string" } }, required: ["date","miles"] } },
  { name: "create_reminder", description: "Create a service reminder for a customer.",
    input_schema: { type: "object", properties: { customer_name: { type: "string" }, service_type: { type: "string" }, due_date: { type: "string" }, message: { type: "string" } }, required: ["customer_name","service_type","due_date"] } },
  { name: "add_boiler_history", description: "Add a service or repair record to a boiler passport.",
    input_schema: { type: "object", properties: { passport_id: { type: "string" }, service_type: { type: "string" }, service_date: { type: "string" }, notes: { type: "string" } }, required: ["passport_id","service_type","service_date"] } },
];
const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

async function runRead(sb: any, name: string, input: any) {
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
    if (name === "financial_summary") {
      const inv = await sb.from("invoices").select("total,status,created_at").gte("created_at", input.from_date).lte("created_at", input.to_date + "T23:59:59");
      const exp = await sb.from("general_expenses").select("amount,date").gte("date", input.from_date).lte("date", input.to_date);
      const mil = await sb.from("mileage_log").select("miles,date").gte("date", input.from_date).lte("date", input.to_date);
      const invoices = inv.data || [];
      const paid = invoices.filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.total || 0), 0);
      const outstanding = invoices.filter((i: any) => i.status === "unpaid" || i.status === "overdue").reduce((s: number, i: any) => s + Number(i.total || 0), 0);
      const expenses = (exp.data || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
      const miles = (mil.data || []).reduce((s: number, m: any) => s + Number(m.miles || 0), 0);
      return { period: { from: input.from_date, to: input.to_date }, invoiced_paid: paid, invoiced_outstanding: outstanding, expenses_total: expenses, total_miles: miles, invoice_count: invoices.length };
    }
  } catch (e) { return { error: String(e) }; }
  return { error: "unknown read tool" };
}

async function sendEmail(payload: any): Promise<boolean> {
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": ANON, "Authorization": "Bearer " + ANON },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch (_e) { return false; }
}

async function runWrite(sb: any, engineerId: string, engName: string, name: string, input: any) {
  try {
    if (name === "create_invoice") {
      const { data, error } = await sb.from("invoices").insert({ engineer_id: engineerId, customer_name: input.customer_name, customer_email: input.customer_email || null, description: input.description, amount: input.amount, vat: 0, total: input.amount, status: "unpaid", due_date: input.due_date || null }).select("id,invoice_number,customer_name,total,status").single();
      return error ? { error: error.message } : { created: "invoice", ...data };
    }
    if (name === "send_invoice") {
      const { data: inv, error: ie } = await sb.from("invoices").select("*").eq("id", input.invoice_id).single();
      if (ie || !inv) return { error: "I couldn't find that invoice." };
      if (!inv.customer_email) return { error: "That invoice has no customer email saved, so I can't send it. Add the email to the invoice first." };
      const ok = await sendEmail({ to: inv.customer_email, subject: "Invoice " + (inv.invoice_number || "") + " from " + engName, type: "invoice",
        data: { invoice_id: inv.invoice_number || inv.id, engineer_name: engName, customer_name: inv.customer_name, amount: inv.amount, total: inv.total, description: inv.description, due_date: inv.due_date, payment_link: inv.payment_link } });
      if (!ok) return { error: "The invoice email didn't go through just then. Please try again shortly." };
      await sb.from("invoices").update({ sent_date: new Date().toISOString() }).eq("id", inv.id);
      return { sent: "invoice", to: inv.customer_email, customer: inv.customer_name, total: inv.total };
    }
    if (name === "chase_payment") {
      const { data: inv, error: ie } = await sb.from("invoices").select("*").eq("id", input.invoice_id).single();
      if (ie || !inv) return { error: "I couldn't find that invoice." };
      if (inv.status === "paid") return { error: "That invoice is already marked as paid — no need to chase it." };
      if (!inv.customer_email) return { error: "That invoice has no customer email saved, so I can't send a reminder." };
      const msg = "Just a friendly reminder that invoice " + (inv.invoice_number || "") + " for £" + inv.total + " is still outstanding." + (inv.payment_link ? " You can pay securely here: " + inv.payment_link : " Please get in touch to arrange payment.");
      const ok = await sendEmail({ to: inv.customer_email, subject: "Payment reminder — invoice " + (inv.invoice_number || ""), type: "generic",
        data: { subject: "A friendly payment reminder", message: msg, engineer_name: engName } });
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
      const { data, error } = await sb.from("quotes").insert({ engineer_id: engineerId, customer_name: input.customer_name, diagnosis: input.diagnosis, parts_cost: input.parts_cost, labour_cost: input.labour_cost, total: total, status: "draft" }).select("id,quote_number,customer_name,total,status").single();
      return error ? { error: error.message } : { created: "quote", ...data };
    }
    if (name === "log_expense") {
      const { data, error } = await sb.from("general_expenses").insert({ engineer_id: engineerId, date: input.date, description: input.description, amount: input.amount, category_label: input.category || null }).select("id,date,description,amount").single();
      return error ? { error: error.message } : { created: "expense", ...data };
    }
    if (name === "log_mileage") {
      const { data, error } = await sb.from("mileage_log").insert({ engineer_id: engineerId, date: input.date, miles: input.miles, from_location: input.from_location || null, to_location: input.to_location || null }).select("id,date,miles").single();
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
  if (tool === "create_invoice") return "Create an invoice for " + input.customer_name + " — \"" + input.description + "\" — £" + input.amount + (input.due_date ? ", due " + input.due_date : "");
  if (tool === "send_invoice") return "Email this invoice to " + (input.customer_name || "the customer");
  if (tool === "chase_payment") return "Send a payment reminder to " + (input.customer_name || "the customer");
  if (tool === "update_job_status") return "Set job " + input.job_id + " to \"" + input.status + "\"";
  if (tool === "create_quote") return "Create a draft quote for " + input.customer_name + " — £" + (Number(input.parts_cost) + Number(input.labour_cost)) + " (parts £" + input.parts_cost + " + labour £" + input.labour_cost + ")";
  if (tool === "log_expense") return "Log an expense — \"" + input.description + "\" — £" + input.amount + " on " + input.date;
  if (tool === "log_mileage") return "Log " + input.miles + " miles on " + input.date;
  if (tool === "create_reminder") return "Create a \"" + input.service_type + "\" reminder for " + input.customer_name + ", due " + input.due_date;
  if (tool === "add_boiler_history") return "Add a \"" + input.service_type + "\" record to a boiler passport (" + input.service_date + ")";
  return "Carry out this action";
}

// ---- Web push: tell the engineer their task is done ---------
function pushMessageFor(tool: string, r: any): string {
  if (tool === "create_invoice") return "Invoice created for " + (r.customer_name || "your customer") + (r.total != null ? " — £" + r.total : "");
  if (tool === "send_invoice") return "Invoice emailed to " + (r.customer || "your customer") + (r.total != null ? " (£" + r.total + ")" : "");
  if (tool === "chase_payment") return "Payment reminder sent to " + (r.customer || "your customer");
  if (tool === "update_job_status") return "Job " + (r.job_number || "") + " set to \"" + (r.status || "updated") + "\"";
  if (tool === "create_quote") return "Quote drafted for " + (r.customer_name || "your customer") + (r.total != null ? " — £" + r.total : "");
  if (tool === "log_expense") return "Expense logged" + (r.amount != null ? " — £" + r.amount : "");
  if (tool === "log_mileage") return "Mileage logged" + (r.miles != null ? " — " + r.miles + " miles" : "");
  if (tool === "create_reminder") return "Service reminder set for " + (r.customer_name || "your customer");
  if (tool === "add_boiler_history") return "Boiler passport updated";
  return "Moti finished the task you asked for.";
}

async function sendPush(sb: any, title: string, bodyText: string): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  try {
    const { data } = await sb.from("push_subscriptions").select("id,subscription");
    if (!data || !data.length) return;
    // Loaded lazily and guarded — a push failure must never break the action.
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

    const { data: eng } = await sb.from("engineers").select("full_name,business_name").eq("id", engineerId).maybeSingle();
    const engName = (eng && eng.full_name) ? eng.full_name : "the engineer";
    const firstName = engName.split(" ")[0];

    const body = await req.json();

    if (body.confirmAction && body.confirmAction.tool) {
      if (!WRITE_NAMES.has(body.confirmAction.tool)) return json({ error: "Unknown action." }, 400);
      const result = await runWrite(sb, engineerId, engName, body.confirmAction.tool, body.confirmAction.input || {});
      if (result.error) return json({ done: false, message: "That didn't go through: " + result.error });
      await sendPush(sb, "Moti — task done", pushMessageFor(body.confirmAction.tool, result));
      return json({ done: true, message: "Done.", result });
    }

    if (!body.message) return json({ error: "No message provided." }, 400);
    const today = new Date().toISOString().slice(0, 10);
    const system = [
      "You are Moti, the operational AI assistant inside HomeLinq Pro. You help a Gas Safe engineer run their business.",
      "You are assisting " + engName + ((eng && eng.business_name) ? " of " + eng.business_name : "") + ". Address them by their first name, " + firstName + ", warmly and naturally — not in every message, just where it feels natural.",
      "Today is " + today + ". All money is in GBP (use the £ sign).",
      "Use the tools to look up the engineer's real jobs, invoices, quotes, finances, reminders, CP12 certificates and boiler passports. Never guess figures or invent data — if you need data, call a tool.",
      "You can create invoices, email invoices to customers, and send polite payment-chase reminders — offer these naturally when they would help.",
      "MIGRATION: if the engineer is new or mentions coming from another platform (Commusoft, Joblogic, ServiceM8, Tradify, BigChange and the like), warmly let them know HomeLinq can import their existing customers, jobs, invoices, certificates and expenses — they export a CSV from their old platform and upload it via the import option in HomeLinq Pro, and HomeLinq auto-maps the data. Offer this help to anyone getting started.",
      "For anything that CHANGES data or sends an email, just call the matching tool. The system automatically pauses and asks " + firstName + " to confirm before it commits — so you do NOT need to ask 'shall I?' yourself, and never claim something is done unless a tool result confirms it.",
      "IMPORTANT: You CANNOT accept jobs from the marketplace — there is deliberately no tool for that. Accepting marketplace work must always be the engineer's own decision. If they ask you to, explain warmly that they need to accept it themselves in the Marketplace section of HomeLinq Pro — but you are happy to help with everything once a job is theirs.",
      "Be warm, brief and plain-spoken. British English. Keep replies short; when listing things, keep them tidy and scannable.",
    ].join("\n");

    const messages: any[] = Array.isArray(body.history) ? body.history.slice(-12) : [];
    messages.push({ role: "user", content: String(body.message) });

    for (let i = 0; i < 6; i++) {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, tools: ALL_TOOLS, messages }),
      });
      if (!aiRes.ok) { console.error("Claude error:", await aiRes.text()); return json({ error: "AI temporarily unavailable." }, 502); }
      const ai = await aiRes.json();
      const content = ai.content || [];
      const textPart = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

      if (ai.stop_reason !== "tool_use") {
        return json({ reply: textPart || "I'm not sure how to help with that one." });
      }
      const writeBlock = content.find((b: any) => b.type === "tool_use" && WRITE_NAMES.has(b.name));
      if (writeBlock) {
        return json({ reply: textPart, proposal: { tool: writeBlock.name, input: writeBlock.input, summary: summarise(writeBlock.name, writeBlock.input) } });
      }
      messages.push({ role: "assistant", content });
      const results: any[] = [];
      for (const b of content) {
        if (b.type === "tool_use") {
          const r = await runRead(sb, b.name, b.input || {});
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
