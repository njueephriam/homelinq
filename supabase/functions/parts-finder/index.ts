// ============================================================
// parts-finder — public online prices for a part from a fixed list of UK merchant sites.
// Shared 24h cache by part number (public prices only), 30 fresh lookups per engineer per day.
// Every link must be a real search result on an allowed shop; duplicates merged; prices marked when the page text confirms them.
// Model: tested 15 Nov 2026 — Haiku mixed up prices between shops; Sonnet reads VAT and part numbers reliably (~10p per fresh check).
// Secret required: ANTHROPIC_API_KEY
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-5-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DAILY = 30;
const CACHE_HOURS = 24;
export const SHOPS: Record<string, string> = {
  "screwfix.com": "Screwfix", "toolstation.com": "Toolstation", "cityplumbing.co.uk": "City Plumbing", "plumbcenter.co.uk": "Plumb Center",
  "wolseley.co.uk": "Wolseley", "partscenter.co.uk": "PartsCenter", "plumbnation.co.uk": "PlumbNation", "plumbworld.co.uk": "Plumbworld",
  "bes.co.uk": "BES", "grahamplumbersmerchant.co.uk": "Graham", "plumbase.co.uk": "Plumbase", "dhsspares.co.uk": "Direct Heating Spares",
  "heatingspares247.com": "Heating Spares 247", "sparesbase.co.uk": "Sparesbase", "hwos.co.uk": "Heating World of Spares",
};
const DOMAINS = Object.keys(SHOPS);
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
export function shopFor(url: string): string | null {
  try { const h = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); for (const d of DOMAINS) if (h === d || h.endsWith("." + d)) return SHOPS[d]; } catch (_e) { /* bad url */ }
  return null;
}
export function matchKey(pn: string, name: string): string {
  const p = String(pn || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return p ? "PN:" + p : "NM:" + String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
const r2 = (n: number) => Math.round(n * 100) / 100;
// Is the price in the page text the search quoted for that page?
export function priceSeen(price: number, texts: string[]): boolean {
  const a = price.toFixed(2);
  return texts.some((t) => String(t || "").replace(/,/g, "").indexOf(a) !== -1);
}
// Same product listed under two addresses (e.g. City Plumbing /p/<slug>/p/124344): key on shop + product id when there is one
export function productKey(url: string): string {
  try { const x = new URL(url); const segs = x.pathname.split("/").filter(Boolean); const last = segs[segs.length - 1] || "";
    return (shopFor(url) || "") + "|" + (/^[a-z]?\d{3,}$/i.test(last) ? last.toLowerCase() : x.pathname.toLowerCase().replace(/\/+$/, "")); } catch (_e) { return url; }
}

const SYSTEM = [
  "You find current public online prices for heating and plumbing parts for a UK Gas Safe engineer.",
  "Search the allowed UK merchant sites for the exact part (prefer the manufacturer's part number). Only include product pages for that exact part — not similar parts, kits, or category pages.",
  "Only report a price you actually saw in the search results for that page. Never estimate, convert or invent a price. If no price is shown for a page, leave it out.",
  "First, for each matching product page, write one short sentence quoting the shop, product and price exactly as the search result shows it (including whether it says inc or ex VAT).",
  "The engineer will compare these with their own trade prices, so say inc or ex VAT only when the page says so; otherwise use \"unknown\".",
  "Then finish with this JSON and nothing after it: {\"results\":[{\"url\":\"product page url\",\"title\":\"product title\",\"price\":12.34,\"vat\":\"inc\"|\"ex\"|\"unknown\",\"in_stock\":true|false|null}]}. Use an empty list if nothing matching was found.",
].join("\n");

async function askClaude(prompt: string) {
  const messages: any[] = [{ role: "user", content: prompt }];
  const all: any[] = [];
  for (let i = 0; i < 3; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SYSTEM, messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3, allowed_domains: DOMAINS, user_location: { type: "approximate", country: "GB", timezone: "Europe/London" } }] }),
    });
    if (!res.ok) { const t = await res.text(); console.error("Claude error", res.status, t); throw new Error("search_unavailable:" + res.status + ":" + t.slice(0, 300)); }
    const ai = await res.json();
    all.push(...(ai.content || []));
    if (ai.stop_reason !== "pause_turn") return { content: all, usage: ai.usage };
    messages.push({ role: "assistant", content: ai.content });
  }
  return { content: all, usage: null };
}

function normUrl(u: string): string { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/+$/, "").toLowerCase(); } catch (_e) { return ""; } }

export function extract(content: any[]) {
  const seen = new Map<string, { title: string }>();
  const cited = new Map<string, string[]>();
  let text = "";
  for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r && r.url) seen.set(normUrl(r.url), { title: r.title || "" });
    }
    if (b.type === "text") {
      text += b.text || "";
      for (const c of (b.citations || [])) if (c && c.url) { const k = normUrl(c.url); const a = cited.get(k) || []; a.push(String(c.cited_text || "") + " " + String(c.title || "")); cited.set(k, a); }
    }
  }
  let parsed: any = null;
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) { try { parsed = JSON.parse(text.slice(s, e + 1)); } catch (_e) { parsed = null; } }
  const out: any[] = [], dropped: any[] = [], used = new Set<string>();
  const list = (parsed && Array.isArray(parsed.results) ? parsed.results : []).slice(0, 15);
  list.sort((a: any, b: any) => (a && a.vat === "unknown" ? 1 : 0) - (b && b.vat === "unknown" ? 1 : 0));
  for (const r of list) {
    const url = String(r && r.url || ""), k = normUrl(url), shop = shopFor(url), price = Number(r && r.price);
    if (!shop) { dropped.push({ url, why: "not an allowed shop" }); continue; }
    if (!seen.has(k)) { dropped.push({ url, why: "not a real search result" }); continue; }
    if (!(price > 0.2 && price < 20000)) { dropped.push({ url, why: "no sensible price" }); continue; }
    const pk = productKey(url); if (used.has(pk)) { dropped.push({ url, why: "duplicate listing" }); continue; } used.add(pk);
    const vat = r.vat === "inc" || r.vat === "ex" ? r.vat : "unknown";
    out.push({ shop, url, title: String(r.title || seen.get(k)!.title).slice(0, 160), price: r2(price), vat,
      price_inc_vat: vat === "inc" ? r2(price) : vat === "ex" ? r2(price * 1.2) : null,
      price_ex_vat: vat === "ex" ? r2(price) : vat === "inc" ? r2(price / 1.2) : null,
      in_stock: typeof r.in_stock === "boolean" ? r.in_stock : null, seen_on_page: priceSeen(price, cited.get(k) || []) });
  }
  out.sort((a, b) => (a.price_inc_vat ?? a.price) - (b.price_inc_vat ?? b.price));
  // Moti's short note (e.g. "that part number is a PCB, not a diverter valve") — the text before the JSON
  let note = (s !== -1 ? text.slice(0, s) : text).replace(/```(json)?/g, "").replace(/\s+\n/g, "\n").trim();
  if (note.length > 700) note = note.slice(0, 700).replace(/\s+\S*$/, "") + "…";
  return { results: out.slice(0, 8), dropped, note };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    let engineerId: string | null = null;
    {
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
      const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: ud, error: ue } = await sb.auth.getUser();
      if (ue || !ud?.user) return json({ error: "Your session has expired — please refresh and sign in again." }, 401);
      const { data: eng } = await sb.from("engineers").select("id").eq("id", ud.user.id).maybeSingle();
      if (!eng) return json({ error: "The parts finder is for HomeLinq Pro engineers." }, 403);
      engineerId = ud.user.id;
    }
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 160), pn = String(body.part_number || "").trim().slice(0, 60), maker = String(body.manufacturer || "").trim().slice(0, 60);
    if (!name && !pn) return json({ error: "Tell me the part name or the maker's part number." }, 400);
    const key = matchKey(pn, name);
    const { data: c } = await admin.from("web_price_cache").select("results,note,checked_at").eq("match_key", key).maybeSingle();
    if (c && !body.refresh && Date.now() - new Date(c.checked_at).getTime() < CACHE_HOURS * 3600000) {
      return json({ results: c.results, note: c.note || "", checked_at: c.checked_at, cached: true, shops: Object.values(SHOPS) });
    }
    if (engineerId) {
      const { data: n, error: be } = await admin.rpc("bump_parts_finder_usage", { p_engineer: engineerId });
      if (!be && Number(n) > DAILY) return json({ error: "You've used today's " + DAILY + " online price checks — they reset at midnight. Your own prices and the shared ranges still work." }, 429);
    }
    const prompt = "Find current UK online prices for: " + [maker, name].filter(Boolean).join(" ") + (pn ? " — manufacturer's part number " + pn : "") + ".";
    let ai;
    try { ai = await askClaude(prompt); }
    catch (_e) { return json({ error: "Online price search isn't available right now — please try again later." }, 502); }
    const x = extract(ai.content);
    const checked_at = new Date().toISOString();
    await admin.from("web_price_cache").upsert({ match_key: key, query: prompt.slice(0, 300), note: x.note, results: x.results, checked_at });
    if (x.dropped.length) console.log("parts-finder dropped:", JSON.stringify(x.dropped).slice(0, 800));
    return json({ results: x.results, note: x.note, checked_at, cached: false, shops: Object.values(SHOPS) });
  } catch (e) {
    console.error("parts-finder error:", e);
    return json({ error: "Something went wrong." }, 500);
  }
});
