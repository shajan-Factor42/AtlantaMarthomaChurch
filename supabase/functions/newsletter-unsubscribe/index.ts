// Newsletter / greetings unsubscribe (no sign-in needed; links are signed per email address).
// l=greetings (or {list:"greetings"}) manages birthday & anniversary greeting emails instead of newsletters.
// POST ?e=<email>&t=<signature>               – one-click unsubscribe from the email app (List-Unsubscribe-Post)
// POST {e, t, action: "unsubscribe"|"resubscribe"} – from the website page /newsletters/unsubscribe/
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = new URL(req.url);
    let e = url.searchParams.get("e") || "", t = url.searchParams.get("t") || "", action = "unsubscribe", list = url.searchParams.get("l") || "";
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      const b = await req.json().catch(() => ({}));
      e = b.e || e; t = b.t || t; list = b.list || list; action = b.action === "resubscribe" ? "resubscribe" : "unsubscribe";
    }
    const greetings = list === "greetings";
    const table = greetings ? "greeting_optouts" : "newsletter_optouts";
    const email = String(e).trim().toLowerCase();
    if (!email || !t) return json({ error: "This unsubscribe link is incomplete." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: s } = await admin.from("app_secrets").select("value").eq("key", "newsletter_unsubscribe").maybeSingle();
    if (!s || (await hmac(s.value, greetings ? `greetings:${email}` : email)) !== String(t)) return json({ error: "This unsubscribe link isn't valid. Please use the link from a recent email." }, 400);

    if (action === "resubscribe") {
      await admin.from(table).delete().eq("email", email);
      return json({ ok: true, subscribed: true, email, list: greetings ? "greetings" : "newsletter" });
    }
    await admin.from(table).upsert({ email });
    return json({ ok: true, subscribed: false, email, list: greetings ? "greetings" : "newsletter" });
  } catch (err) {
    return json({ error: (err as Error).message || String(err) }, 500);
  }
});
