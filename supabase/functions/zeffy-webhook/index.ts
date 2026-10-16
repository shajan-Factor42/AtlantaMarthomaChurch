// Zeffy → portal: receives Zeffy's payment.completed webhook (every one-time payment and every monthly charge).
// Zeffy calls https://<project>.supabase.co/functions/v1/zeffy-webhook?token=<secret>; the token lives in
// app_secrets 'zeffy_webhook' and admins copy the full URL from Admin → Portal Settings → Online giving.
// Records the payment in zeffy_payments, matches it to a family by email, and — when giving is not coming
// from ICON — a database trigger adds it to that family's contributions so it shows on their statement.
// Optional secret ZEFFY_API_KEY: if set, each payment is double-checked with Zeffy's API before recording.
import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (...vs: unknown[]) => {
  for (const v of vs) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
};
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[$,]/g, "")))) return Number(v.replace(/[$,]/g, ""));
  if (v && typeof v === "object") return num((v as Obj).value ?? (v as Obj).amount);
  return undefined;
};
const isEmail = (v: unknown) => { const s = str(v); return s && s.includes("@") ? s.toLowerCase() : undefined; };
const slug = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Last path segment of a Zeffy form link: https://www.zeffy.com/en-US/donation-form/monthly-subscription → monthly-subscription
const formSlug = (url?: string) => { try { return slug(new URL(url || "").pathname.split("/").filter(Boolean).pop()); } catch { return ""; } };

// Zeffy sends amounts in cents (integers). A value with a fractional part is already dollars.
function dollars(p: Obj): number | undefined {
  const cents = num(p.amountCents ?? p.amount_cents ?? p.amount_in_cents);
  if (cents !== undefined) return Math.round(cents) / 100;
  const a = num(p.amount ?? p.total ?? p.total_amount);
  if (a === undefined) return undefined;
  return Number.isInteger(a) ? a / 100 : Math.round(a * 100) / 100;
}

function emailsOf(p: Obj): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { const e = isEmail(v); if (e && !out.includes(e)) out.push(e); };
  const fromContact = (c: Obj) => { add(c.email); add(c.emailAddress); add(c.email_address); add(c.payer_email); };
  for (const k of ["buyer", "customer", "donor", "payer", "contact"]) fromContact(obj(p[k]));
  add(p.email); add(p.payer_email); add(p.payerEmail);
  for (const it of arr(p.items)) { const o = obj(it); fromContact(o); fromContact(obj(o.contact)); fromContact(obj(o.buyer)); }
  return out;
}

function nameOf(p: Obj): string | undefined {
  for (const k of ["buyer", "customer", "donor", "payer", "contact"]) {
    const c = obj(p[k]);
    const n = str(c.name, c.fullName, c.full_name, [c.first_name ?? c.firstName, c.last_name ?? c.lastName].filter(Boolean).join(" "));
    if (n) return n;
  }
  return str(p.name, p.payer_name, p.payerName);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "zeffy_webhook").maybeSingle();
    const supplied = new URL(req.url).searchParams.get("token") || req.headers.get("x-zeffy-token") || "";
    if (!sec?.value || supplied !== sec.value) return json({ error: "Unauthorized" }, 401);

    const env = obj(await req.json().catch(() => ({})));
    const type = str(env.type, env.event, env.event_type);
    if (type && type !== "payment.completed") return json({ received: true, ignored: type });   // ack other events so Zeffy doesn't retry
    const data = obj(env.data);
    const p = obj(data.payment ?? data.object ?? env.payment ?? (Object.keys(data).length ? data : env));

    const id = str(p.id, p.payment_id, p.paymentId, p.transaction_id);
    const amount = dollars(p);
    if (!id || amount === undefined) return json({ error: "Payment id and amount are required" }, 400);

    // Optional: confirm with Zeffy that this payment is real.
    const apiKey = Deno.env.get("ZEFFY_API_KEY");
    if (apiKey) {
      const r = await fetch(`https://api.zeffy.com/api/v1/payments/${encodeURIComponent(id)}`, { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` } });
      if (!r.ok) return json({ error: "Could not verify the payment with Zeffy" }, 502);
    }

    const { data: setRows } = await sb.from("portal_settings").select("key, value").eq("key", "zeffy");
    const S = obj(setRows?.[0]?.value);

    const campaignObj = obj(p.campaign);
    const campaign = str(campaignObj.title, campaignObj.name, p.campaign_name, p.campaignName, p.campaign_title, p.form_title, p.title, typeof p.campaign === "string" && !/^[0-9a-f-]{20,}$/i.test(p.campaign) ? p.campaign : undefined, p.description);
    const campaignUrl = str(campaignObj.url, p.campaign_url, p.campaignUrl, p.url, p.form_url);
    const blob = JSON.stringify(p).toLowerCase();
    const recurring = /"(frequency|recurrence|recurrence_interval|interval|occurrence|recurring_interval|donation_frequency)"\s*:\s*"(month|monthly)/.test(blob)
      || /"(is_recurring|recurring|isrecurring)"\s*:\s*true/.test(blob);
    // Which of the church's forms was this? Compare form slugs, then fall back to name hints.
    const keys = [slug(campaign), formSlug(campaignUrl), slug(str(campaignObj.slug, p.campaign_slug))].filter(Boolean);
    const matches = (url: unknown) => { const s = formSlug(String(url || "")); return !!s && keys.some((k) => k === s || k.includes(s) || s.includes(k)); };
    const kind = matches(S.monthly_url) ? "monthly" : matches(S.other_url) ? "other" : matches(S.donate_url) ? "donation"
      : recurring || /subscription|monthly/i.test(campaign || "") ? "monthly" : "donation";

    const emails = emailsOf(p);
    let member: Obj | null = null;
    for (const e of emails) {
      const { data: m } = await sb.from("members").select("id, family_id").ilike("email", e).not("family_id", "is", null).limit(1).maybeSingle();
      if (m) { member = m; break; }
    }
    const status = (str(p.status) || "succeeded").toLowerCase();
    const created = num(p.created ?? p.created_at ?? p.date);
    const paidAt = created && created > 1e9 && created < 1e11 ? new Date(created * 1000).toISOString()
      : str(p.created_at, p.date, p.paid_at) && !isNaN(Date.parse(str(p.created_at, p.date, p.paid_at)!)) ? new Date(str(p.created_at, p.date, p.paid_at)!).toISOString()
      : new Date().toISOString();

    const { data: existing } = await sb.from("zeffy_payments").select("id, family_id").eq("id", id).maybeSingle();
    const row: Obj = {
      id, paid_at: paidAt, amount, currency: (str(p.currency) || "usd").toLowerCase(), status,
      email: emails[0] || null, name: nameOf(p) || null, campaign: campaign || null, kind, recurring: recurring || kind === "monthly",
      raw: env,
    };
    if (!existing?.family_id) { row.family_id = member?.family_id ?? null; row.member_id = member?.id ?? null; }
    const { error: upErr } = await sb.from("zeffy_payments").upsert(row, { onConflict: "id" });
    if (upErr) throw new Error(upErr.message);

    // A database trigger posts matched payments to the family's giving (unless giving comes from ICON).
    const { data: saved } = await sb.from("zeffy_payments").select("family_id, contribution_id").eq("id", id).single();
    return json({ received: true, matched: !!saved?.family_id, kind, posted: !!saved?.contribution_id });
  } catch (e) {
    console.error("zeffy-webhook", e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
