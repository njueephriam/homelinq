// Moti chat — HomeLinq Edge Function
// Deploy: supabase functions deploy moti-chat
// Secret required: ANTHROPIC_API_KEY  (set in Supabase Edge Function secrets)
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-haiku-4-5-20251001";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const { message, history = [], sessionId = null } = await req.json();
    if (!message || typeof message !== "string") return json({ error: "No message provided." }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: kb } = await supabase
      .from("moti_knowledge").select("topic, question, answer").eq("active", true);
    const knowledge = (kb ?? [])
      .map((k: { topic: string; question: string; answer: string }) =>
        `[${k.topic}]\nQ: ${k.question}\nA: ${k.answer}`).join("\n\n");

    const systemPrompt = [
      "You are Moti, the friendly AI assistant inside HomeLinq.",
      "HomeLinq connects homeowners with Gas Safe registered engineers for boiler repairs, servicing, installations and gas safety certificates.",
      "You help two kinds of people: homeowners who want to book an engineer, and Gas Safe engineers who use HomeLinq Pro to run their business.",
      "",
      "Personality: warm, calm, reassuring and plain-spoken. Short sentences. British English. No jargon or marketing fluff.",
      "",
      "Rules:",
      "- Answer ONLY from the HomeLinq knowledge below. Do not invent facts, prices, features or claims.",
      "- If you do not know something, say so plainly and suggest the visitor contact HomeLinq support.",
      "- Keep replies short and chat-sized: usually 2 to 4 sentences.",
      "- Do not use markdown headings or bullet symbols. Write in plain sentences.",
      "- SAFETY: if someone describes a gas emergency or smelling gas, tell them immediately to leave the property and call the National Gas Emergency line on 0800 111 999.",
      "",
      "HOMELINQ KNOWLEDGE:",
      knowledge || "(no knowledge loaded)",
    ].join("\n");

    const turns = (Array.isArray(history) ? history : [])
      .filter((m: { role: string; content: string }) =>
        m && (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-10)
      .map((m: { role: string; content: string }) => ({ role: m.role, content: String(m.content) }));
    turns.push({ role: "user", content: message });

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 600, system: systemPrompt, messages: turns }),
    });
    if (!aiRes.ok) {
      console.error("Claude API error:", await aiRes.text());
      return json({ error: "AI temporarily unavailable." }, 502);
    }
    const aiData = await aiRes.json();
    const reply: string = aiData?.content?.[0]?.text?.trim() ||
      "Sorry — I could not put an answer together just then. Please try again.";

    let messageId: string | null = null;
    const { data: logged } = await supabase
      .from("moti_messages")
      .insert([
        { session_id: sessionId, role: "user", content: message },
        { session_id: sessionId, role: "assistant", content: reply },
      ]).select("id, role");
    if (logged) {
      const asst = logged.find((r: { role: string }) => r.role === "assistant");
      messageId = asst ? asst.id : null;
    }
    return json({ reply, messageId });
  } catch (err) {
    console.error("moti-chat error:", err);
    return json({ error: "Something went wrong." }, 500);
  }
});
