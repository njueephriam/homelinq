// moti-import v3 — Moti helps engineers move their records into HomeLinq.
// Moti never receives the full file: only column headings, column PROFILES computed on the engineer's
// device (fill rates, types, ranges, non-personal value counts) and a few masked sample rows.
// actions: analyse (one file, first pass) · converse (whole-import conversation) · save_template
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-haiku-4-5-20251001";
const DAILY_AI_CALLS = 300; // fair use per engineer per day
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FIELDS: Record<string, Record<string, string>> = {
  customers: { name: "customer full name (required)", email: "email address", phone: "phone / mobile", address: "street address", postcode: "UK postcode", company: "company / business name" },
  jobs: { date: "job / visit date (required)", customer: "customer name (required)", email: "customer email", phone: "customer phone", type: "job type / service", description: "job description / notes", address: "job address", postcode: "job postcode", price: "price / amount charged", status: "job status", time: "appointment time", ref: "job reference / number" },
  invoices: { number: "invoice number", customer: "customer name (required)", email: "customer email", date: "invoice date", dueDate: "due date", total: "invoice TOTAL including VAT (required)", vat: "VAT amount", status: "paid / unpaid status", items: "description of items / work" },
  certificates: { certNumber: "certificate number", certType: "certificate type (CP12, non-domestic, oil, warning notice, commissioning)", recipientName: "recipient / customer name", recipientEmail: "recipient email", landlord: "landlord name", tenant: "tenant name", prop: "property address (required)", date: "inspection / issue date", expiry: "expiry / next inspection due date", result: "pass / fail result", engineerName: "engineer who issued it", gasSafe: "engineer Gas Safe number", recipientType: "recipient type (landlord/tenant/agent)" },
  expenses: { date: "expense date", amount: "amount (required)", category: "expense category", description: "description (required)", vendor: "supplier / vendor" },
};
const TYPES = Object.keys(FIELDS);
const SOFTWARE = ["commusoft", "gas_engineer_software", "tradify", "joblogic", "servicem8", "bigchange", "spreadsheet", "unknown"];
const VALUE_TARGETS: Record<string, Record<string, string[]>> = {
  invoices: { status: ["paid", "unpaid", "cancelled"] },
  jobs: { status: ["completed", "upcoming", "in_progress", "cancelled"] },
  certificates: { certType: ["domestic", "non_domestic", "oil", "warning", "commissioning"], result: ["pass", "fail"] },
};
const IMPORTER_RULES = [
  "How the HomeLinq importer behaves: files are imported in the order customers → jobs → invoices → certificates → expenses.",
  "After this Check step comes Review: every row is checked against the files and the engineer's existing HomeLinq records. Rows that can't be imported are listed with the reason and can be edited there; duplicates (same customer email/phone/name+postcode, same invoice or certificate number, same job or expense details) are shown and the engineer chooses Skip (the default), Fill in missing details (customers only, never overwrites) or Import anyway; totals and date ranges are shown to compare with the old system.",
  "After importing, the engineer can Undo the whole import, and an import that stopped part-way can be finished later by uploading the same files again.",
  "Imported invoices are stored as history (numbered IMP-<original number>) and are NEVER emailed or chased.",
  "Imported certificates are kept as read-only records of the ORIGINAL engineer (their name, Gas Safe number, date, certificate number).",
  "Jobs, invoices and certificates are attached to customers by name/email, so they need a customer name column (or a link to the customers file).",
  "Dates without a known format are read as UK day/month/year.",
].join(" ");

function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
function normHeader(h: string): string { return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
async function signature(headers: string[]): Promise<string> {
  const s = headers.map(normHeader).filter(Boolean).sort().join("|");
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cleanMapping(type: string, mapping: any, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!mapping || typeof mapping !== "object" || !FIELDS[type]) return out;
  for (const f of Object.keys(FIELDS[type])) {
    const v = mapping[f];
    if (typeof v === "string" && headers.indexOf(v) !== -1) out[f] = v;
  }
  return out;
}
function clip(v: unknown, n: number): string { return String(v === undefined || v === null ? "" : v).slice(0, n); }

async function callClaude(system: string, messages: any[], tool: any, maxTokens: number): Promise<any> {
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, tools: [tool], tool_choice: { type: "tool", name: tool.name }, messages }),
  });
  if (!aiRes.ok) { console.error("Claude error:", await aiRes.text()); return null; }
  const ai = await aiRes.json();
  const block = (ai.content || []).find((b: any) => b.type === "tool_use");
  return block ? (block.input || {}) : null;
}

const ANALYSE_TOOL = {
  name: "report_import_analysis",
  description: "Report how this exported file should be imported into HomeLinq.",
  input_schema: {
    type: "object",
    properties: {
      record_type: { type: "string", enum: TYPES },
      software: { type: "string", enum: SOFTWARE },
      mapping: { type: "object", description: "HomeLinq field -> exact column heading from the file. Only include fields you are confident about.", additionalProperties: { type: "string" } },
      date_format: { type: "string", enum: ["DMY", "MDY", "YMD", "unknown"] },
      confidence: { type: "number", description: "0 to 1" },
      questions: {
        type: "array", maxItems: 3,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["date_format", "mapping", "info"] },
            field: { type: "string" },
            text: { type: "string", description: "Short plain-English question for a gas engineer (British English)" },
            options: { type: "array", maxItems: 4, items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] } },
          },
          required: ["kind", "text"],
        },
      },
      notes: { type: "string", description: "One short sentence summary for the engineer" },
    },
    required: ["record_type", "software", "mapping", "date_format", "confidence"],
  },
};

const CONVERSE_TOOL = {
  name: "reply_to_engineer",
  description: "Reply to the engineer and propose concrete changes to the import, which the engineer approves one by one.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Your message to the engineer. British English, friendly, concise, short paragraphs or simple bullet lines starting with '• '. You may use **bold**. No tables or headings." },
      actions: {
        type: "array", maxItems: 8,
        description: "Concrete changes you recommend now. Each becomes a card with an Apply button. Only propose what you are confident about or what the engineer asked for. Empty if nothing to change.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["set_type", "set_mapping", "set_date_format", "skip_file", "include_file", "link_files", "map_value"] },
            file_id: { type: "integer" },
            record_type: { type: "string", enum: TYPES, description: "set_type" },
            field: { type: "string", description: "set_mapping / map_value: HomeLinq field" },
            column: { type: "string", description: "set_mapping: exact column heading, or empty string to leave the field empty. link_files: the column in this file that holds the customer reference" },
            date_format: { type: "string", enum: ["DMY", "MDY", "YMD"], description: "set_date_format" },
            target_file_id: { type: "integer", description: "link_files: the customers file" },
            target_column: { type: "string", description: "link_files: matching column in the customers file" },
            from_value: { type: "string", description: "map_value: an existing value exactly as listed in the column's top_values" },
            to_value: { type: "string", description: "map_value: the HomeLinq value it should become" },
          },
          required: ["kind", "file_id"],
        },
      },
      memory: { type: "string", description: "Running notes (max 800 characters) of what the engineer has told you and what has been decided, so you can continue later. Rewrite in full each time. Never include customers' personal details." },
    },
    required: ["reply", "actions", "memory"],
  },
};

function sanitiseFiles(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((f: any) => {
    const headers: string[] = Object.keys((f && f.columns) || {}).slice(0, 80).map((h) => clip(h, 100));
    const cols: Record<string, any> = {};
    headers.forEach((h) => {
      const p = f.columns[h] || {};
      const o: any = { filled_pct: Number(p.filled_pct) || 0, kind: clip(p.kind, 12) };
      ["distinct", "unique_pct", "avg_len", "min", "max", "zeros", "negatives", "from", "to", "date_hint", "personal"].forEach((k) => { if (p[k] !== undefined && p[k] !== null) o[k] = typeof p[k] === "number" || typeof p[k] === "boolean" ? p[k] : clip(p[k], 30); });
      if (p.kinds && typeof p.kinds === "object") o.kinds = p.kinds;
      if (Array.isArray(p.top_values)) o.top_values = p.top_values.slice(0, 12).map((t: any) => [clip(t && t[0], 40), Number(t && t[1]) || 0]);
      cols[h] = o;
    });
    const mapping: Record<string, string> = {};
    const type = TYPES.indexOf(f.type) !== -1 ? f.type : "customers";
    Object.keys(FIELDS[type]).forEach((k) => { const v = f.mapping && f.mapping[k]; if (typeof v === "string" && v && headers.indexOf(v) !== -1) mapping[k] = v; });
    const samples = Array.isArray(f.masked_samples) ? f.masked_samples.slice(0, 3).map((r: any) => { const o: Record<string, string> = {}; headers.forEach((h) => { o[h] = clip(r && r[h], 50); }); return o; }) : [];
    return {
      file_id: Number(f.file_id) || 0, name: clip(f.name, 120), rows: Number(f.rows) || 0, type,
      type_chosen_by_engineer: !!f.type_chosen_by_engineer, skipped: !!f.skipped,
      date_format: ["DMY", "MDY", "YMD"].indexOf(f.date_format) !== -1 ? f.date_format : null,
      mapping, missing_required: Array.isArray(f.missing_required) ? f.missing_required.slice(0, 10).map((x: any) => clip(x, 30)) : [],
      linked: f.linked ? { column: clip(f.linked.column, 100), target_file_id: Number(f.linked.target_file_id) || 0, target_column: clip(f.linked.target_column, 100), matched_rows: Number(f.linked.matched) || 0 } : null,
      first_pass: f.earlier_analysis ? { software: clip(f.earlier_analysis.software, 30), confidence: Number(f.earlier_analysis.confidence) || 0, notes: clip(f.earlier_analysis.notes, 300), open_questions: Array.isArray(f.earlier_analysis.open_questions) ? f.earlier_analysis.open_questions.slice(0, 3).map((q: any) => clip(q, 200)) : [] } : null,
      columns: cols, masked_samples: samples,
    };
  });
}

function validAction(a: any, files: any[]): any | null {
  if (!a || typeof a !== "object") return null;
  const f = files.find((x) => x.file_id === Number(a.file_id));
  if (!f) return null;
  const headers = Object.keys(f.columns);
  const out: any = { kind: a.kind, file_id: f.file_id };
  switch (a.kind) {
    case "set_type":
      if (TYPES.indexOf(a.record_type) === -1 || a.record_type === f.type) return null;
      out.record_type = a.record_type; return out;
    case "set_mapping": {
      // field must belong to the file's type (or the type being proposed in the same reply — checked client side)
      const allFields = TYPES.reduce((acc: string[], t) => acc.concat(Object.keys(FIELDS[t])), []);
      if (allFields.indexOf(a.field) === -1) return null;
      const col = String(a.column || "");
      if (col && headers.indexOf(col) === -1) return null;
      out.field = a.field; out.column = col; return out;
    }
    case "set_date_format":
      if (["DMY", "MDY", "YMD"].indexOf(a.date_format) === -1) return null;
      out.date_format = a.date_format; return out;
    case "skip_file": if (f.skipped) return null; return out;
    case "include_file": if (!f.skipped) return null; return out;
    case "link_files": {
      const t = files.find((x) => x.file_id === Number(a.target_file_id));
      if (!t || t.file_id === f.file_id) return null;
      if (headers.indexOf(a.column) === -1 || Object.keys(t.columns).indexOf(a.target_column) === -1) return null;
      out.column = a.column; out.target_file_id = t.file_id; out.target_column = a.target_column; return out;
    }
    case "map_value": {
      const allowed = (VALUE_TARGETS[f.type] || {})[a.field];
      if (!allowed || allowed.indexOf(a.to_value) === -1) return null;
      const col = f.mapping[a.field];
      const tv = col && f.columns[col] && f.columns[col].top_values;
      if (!tv || !tv.some((t: any) => t[0] === a.from_value)) return null;
      out.field = a.field; out.from_value = a.from_value; out.to_value = a.to_value; return out;
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Sign in required" }, 401);
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
    const { data: ud, error: uerr } = await sb.auth.getUser();
    if (uerr || !ud?.user) return json({ error: "Session expired" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: eng } = await admin.from("engineers").select("status").eq("id", ud.user.id).maybeSingle();
    if (!eng || eng.status !== "approved") return json({ error: "Only approved engineers can import data" }, 403);

    const body = await req.json();

    async function fairUse(): Promise<boolean> {
      const { data, error } = await admin.rpc("bump_moti_import_usage", { p_engineer: ud!.user!.id });
      if (error) { console.error("usage error:", error.message); return true; }
      return (Number(data) || 0) <= DAILY_AI_CALLS;
    }

    // ---------- Whole-import conversation ----------
    if (body.action === "converse") {
      const files = sanitiseFiles(body.files);
      if (!files.length) return json({ error: "No files to discuss" }, 400);
      if (!(await fairUse())) return json({ error: "You've reached today's fair-use limit for Moti's import help. You can still check the columns yourself and import — Moti will be back tomorrow." }, 429);
      const links = Array.isArray(body.links) ? body.links.slice(0, 10).map((l: any) => ({ file_id: Number(l.file_id) || 0, column: clip(l.column, 100), target_file_id: Number(l.target_file_id) || 0, target_column: clip(l.target_column, 100), match_pct: Number(l.match_pct) || 0 })) : [];
      const memory = clip(body.memory, 1000);
      const fieldText = TYPES.map((t) => t + ": " + Object.keys(FIELDS[t]).map((f) => f + " = " + FIELDS[t][f]).join("; ")).join("\n");
      const valueText = Object.keys(VALUE_TARGETS).map((t) => Object.keys(VALUE_TARGETS[t]).map((f) => t + "." + f + " → " + VALUE_TARGETS[t][f].join(" | ")).join("; ")).join("; ");
      const system = [
        "You are Moti, HomeLinq's assistant, helping a UK Gas Safe engineer move their records into HomeLinq from another system (Commusoft, Gas Engineer Software, Tradify, Joblogic, ServiceM8, BigChange) or from spreadsheets.",
        "You and the engineer work TOGETHER: you are often better at reading an export than they are, and they know their business. Understand what they are trying to do, explain what you see in plain words, ask when you are unsure, and propose concrete changes as actions. The engineer approves each action with an Apply button — never say you have changed something yourself.",
        "PRIVACY: you only see column profiles and masked samples (*** = hidden personal details). That is expected; never ask the engineer to type customers' names, emails, phones or addresses. 'personal: true' columns show no values.",
        "HomeLinq fields by record type:\n" + fieldText,
        "map_value targets: " + valueText + ". Use map_value for status / type values the importer would misread (e.g. 'Part paid' should usually be unpaid; the default reading treats unknown invoice statuses as unpaid and unknown job statuses as completed).",
        IMPORTER_RULES,
        "What to look for: the right record type per file; required fields not matched (missing_required); total INCLUDING VAT vs net; date_format evidence (date_hint: DMY, MDY, YMD, ambiguous, mixed); status values needing map_value; files that are not the engineer's records (propose skip_file and say why); links between files (the 'links' list gives match_pct between a column in one file and a column in another) — when a jobs/invoices/certificates file has no customer name, or a customer reference column matches a customers file strongly, propose link_files with target = the customers file; suspicious data (many £0 totals, negative amounts, empty columns, very old or future dates).",
        "Your first message: a brief overview of each file (what it is, rows, anything notable), then your proposals as actions, then at most one or two questions. Later messages: answer what the engineer said, and propose actions when a change is needed. Don't repeat actions that were applied or declined ([Engineer action] lines). Keep replies short — this is a chat, not a report.",
        "If the engineer asks about something unrelated to importing, answer briefly and bring it back to the import.",
        "Engineer said their old system is: " + clip(body.software || "unknown", 40) + ".",
        "Notes you kept so far: " + (memory || "(none yet)"),
        "CURRENT FILES (file_id is what actions refer to):\n" + JSON.stringify(files),
        "CROSS-FILE MATCHES:\n" + JSON.stringify(links),
        "Always respond by calling reply_to_engineer exactly once.",
      ].join("\n\n");

      // History → alternating messages that start with the user
      const hist: any[] = Array.isArray(body.history) ? body.history.slice(-16) : [];
      const msgs: any[] = [];
      hist.forEach((m: any) => {
        const role = m && m.role === "assistant" ? "assistant" : "user";
        const text = clip(m && m.text, 2000).trim();
        if (!text) return;
        if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + text;
        else msgs.push({ role, content: text });
      });
      while (msgs.length && msgs[0].role !== "user") msgs.shift();
      if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
        msgs.push({ role: "user", content: msgs.length ? "[The files or my choices have changed — please take another look and tell me what you suggest.]" : "Please look over my files and tell me what you suggest." });
      }
      const r = await callClaude(system, msgs, CONVERSE_TOOL, 2000);
      if (!r) return json({ error: "Moti is unavailable right now — you can still check the columns yourself and import." }, 502);
      const actions = (Array.isArray(r.actions) ? r.actions : []).map((a: any) => validAction(a, files)).filter(Boolean).slice(0, 8);
      return json({ reply: clip(r.reply, 4000), actions, memory: clip(r.memory, 900) });
    }

    const headers: string[] = Array.isArray(body.headers) ? body.headers.map((h: any) => String(h).slice(0, 100)).slice(0, 200) : [];
    if (!headers.length) return json({ error: "No column headings provided" }, 400);
    const sig = await signature(headers);

    // ---------- Save a confirmed mapping as a shared template (column names only) ----------
    if (body.action === "save_template") {
      const type = String(body.record_type || "");
      if (TYPES.indexOf(type) === -1) return json({ error: "Bad record type" }, 400);
      const mapping = cleanMapping(type, body.mapping, headers);
      if (!Object.keys(mapping).length) return json({ error: "Empty mapping" }, 400);
      const software = SOFTWARE.indexOf(body.software) !== -1 ? body.software : "unknown";
      const df = ["DMY", "MDY", "YMD"].indexOf(body.date_format) !== -1 ? body.date_format : null;
      const { data: existing } = await admin.from("import_templates").select("id,uses").eq("header_signature", sig).eq("record_type", type).maybeSingle();
      if (existing) {
        await admin.from("import_templates").update({ mapping, date_format: df, source_software: software, uses: (existing.uses || 0) + 1, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await admin.from("import_templates").insert({ header_signature: sig, record_type: type, mapping, date_format: df, source_software: software, uses: 1 });
      }
      return json({ saved: true });
    }

    // ---------- First-pass analysis of one file ----------
    const { data: tpl } = await admin.from("import_templates").select("record_type,source_software,mapping,date_format,uses").eq("header_signature", sig).order("uses", { ascending: false }).limit(1).maybeSingle();
    if (tpl) {
      return json({ record_type: tpl.record_type, software: tpl.source_software, mapping: cleanMapping(tpl.record_type, tpl.mapping, headers), date_format: tpl.date_format || "unknown", confidence: 0.99, questions: [], notes: "Matched a saved format used by other engineers.", from_template: true });
    }
    if (!(await fairUse())) return json({ error: "Daily fair-use limit reached" }, 429);
    const samples: any[] = Array.isArray(body.samples) ? body.samples.slice(0, 5).map((r: any) => {
      const o: Record<string, string> = {};
      headers.forEach((h) => { o[h] = String(r && r[h] !== undefined && r[h] !== null ? r[h] : "").slice(0, 60); });
      return o;
    }) : [];
    const fieldText = TYPES.map((t) => t + ": " + Object.keys(FIELDS[t]).map((f) => f + " = " + FIELDS[t][f]).join("; ")).join("\n");
    const system = [
      "You help UK Gas Safe engineers move their records into HomeLinq from other job-management systems (Commusoft, Gas Engineer Software, Tradify, Joblogic, ServiceM8, BigChange) or spreadsheets.",
      "You receive a file's column headings and up to 5 sample rows in which personal details are masked with *** (that is expected; never comment on it).",
      "Decide which kind of records the file holds and map HomeLinq fields to the exact column headings. Use only headings that appear in the file, spelled exactly.",
      "HomeLinq fields by record type:\n" + fieldText,
      "Rules: map 'total' to the amount INCLUDING VAT when both net and gross columns exist. Detect the date format from the sample values (UK files are usually DMY). If a date like 03/04/2025 cannot be resolved from the samples, ask a date_format question with options DMY and MDY.",
      "Only ask a question when you genuinely cannot decide (max 3). For a mapping question, set field and give the candidate headings as option values.",
      "Call the report_import_analysis tool exactly once.",
    ].join("\n");
    const user = JSON.stringify({ file_name: String(body.file_name || "").slice(0, 120), engineer_says_software: String(body.software || "unknown"), row_count: Number(body.row_count) || 0, headings: headers, masked_samples: samples });
    const r = await callClaude(system, [{ role: "user", content: user }], ANALYSE_TOOL, 1500);
    if (!r) return json({ error: "Moti is unavailable right now" }, 502);
    const type = TYPES.indexOf(r.record_type) !== -1 ? r.record_type : "customers";
    const questions = (Array.isArray(r.questions) ? r.questions : []).slice(0, 3).map((q: any, i: number) => ({
      id: "q" + i,
      kind: ["date_format", "mapping", "info"].indexOf(q.kind) !== -1 ? q.kind : "info",
      field: FIELDS[type][q.field] ? q.field : undefined,
      text: String(q.text || "").slice(0, 300),
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map((o: any) => ({ label: String(o.label || o.value || "").slice(0, 80), value: String(o.value || "").slice(0, 100) }))
        .filter((o: any) => q.kind !== "mapping" || headers.indexOf(o.value) !== -1),
    })).filter((q: any) => q.text && (q.kind === "info" || q.options.length));
    return json({
      record_type: type,
      software: SOFTWARE.indexOf(r.software) !== -1 ? r.software : "unknown",
      mapping: cleanMapping(type, r.mapping, headers),
      date_format: ["DMY", "MDY", "YMD"].indexOf(r.date_format) !== -1 ? r.date_format : "unknown",
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
      questions,
      notes: String(r.notes || "").slice(0, 300),
      from_template: false,
    });
  } catch (e) {
    console.error("moti-import error:", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
