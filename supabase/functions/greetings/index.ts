// Birthday & wedding anniversary greetings (Admin → Greetings).
// Called by a signed-in officer/admin, or each morning by pg_cron (x-cron-key header).
// Actions:
//   list   {from, to}            – who is celebrating between two dates, who it goes to, and whether it was sent
//   render {kind, template?}     – preview HTML for the editor
//   test   {kind, to, template?} – send a sample to one address
//   send   {from, to, ids}       – send the chosen greetings (up to 25 per call; the page repeats)
//   auto                          – (cron) send today's greetings if "Send automatically" is on
// Each person gets each greeting at most once a year (greeting_deliveries).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = "America/New_York";
const BATCH = 25, GAP_MS = 550;
const SITE_DEFAULT = "https://shajan-factor42.github.io/AtlantaMarthomaChurch";
const SITE_OK = [/^https:\/\/shajan-factor42\.github\.io\/AtlantaMarthomaChurch$/i, /^https:\/\/(www\.)?mtcatlanta\.org$/i];
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
const ADULT = new Set(["Head", "Spouse"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const ordinal = (n: number) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Tpl = { subject?: string; message?: string; signoff?: string; image_url?: string | null };
type Item = {
  id: string; kind: "birthday" | "anniversary"; key: string; date: string; name: string;
  vars: Record<string, string>; emails: string[]; via_family: boolean; opted_out?: boolean; status: string | null; sent_at: string | null; error: string | null;
};

// deno-lint-ignore no-explicit-any
async function celebrations(admin: any, from: string, to: string): Promise<Item[]> {
  const [{ data: mems }, { data: outs }] = await Promise.all([
    admin.from("members").select("id, first_name, last_name, email, date_of_birth, wedding_date, family_id, relationship, status, family:families(status, family_name)"),
    admin.from("greeting_optouts").select("email"),
  ]);
  const opted = new Set((outs || []).map((o: { email: string }) => o.email.toLowerCase()));
  // deno-lint-ignore no-explicit-any
  const members = (mems || []).filter((m: any) => (!m.family || m.family.status !== "inactive") && (m.status ?? "active") === "active");
  // deno-lint-ignore no-explicit-any
  const byFamily = new Map<string, any[]>();
  for (const m of members) if (m.family_id) (byFamily.get(m.family_id) || byFamily.set(m.family_id, []).get(m.family_id))!.push(m);
  const mail = (e: string | null) => (e ? String(e).trim().toLowerCase() : "");
  const ok = (e: string) => EMAIL_RE.test(e) && !opted.has(e);
  // deno-lint-ignore no-explicit-any
  const parentsOf = (m: any) => [...new Set((byFamily.get(m.family_id) || []).filter((x) => x.id !== m.id && ADULT.has(x.relationship)).map((x) => mail(x.email)).filter(ok))];

  // Dates in range → month-day
  const days: { date: string; mds: string[]; year: number }[] = [];
  for (let d = new Date(from + "T12:00:00Z"); d.toISOString().slice(0, 10) <= to && days.length < 92; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10), y = d.getUTCFullYear(), md = date.slice(5);
    days.push({ date, year: y, mds: md === "02-28" && !isLeap(y) ? ["02-28", "02-29"] : [md] });
  }
  const items: Item[] = [];
  for (const { date, mds, year } of days) {
    for (const m of members) {
      if (!m.date_of_birth || !mds.includes(m.date_of_birth.slice(5))) continue;
      const own = mail(m.email);
      const emails = ok(own) ? [own] : opted.has(own) ? [] : parentsOf(m);
      items.push({
        id: `birthday:${m.id}:${year}`, kind: "birthday", key: m.id, date, name: `${m.first_name} ${m.last_name}`,
        vars: { first_name: m.first_name, name: `${m.first_name} ${m.last_name}` },
        emails, via_family: !ok(own) && emails.length > 0, opted_out: opted.has(own), status: null, sent_at: null, error: null,
      });
    }
    // Anniversaries: one greeting per couple (same family + same wedding date)
    // deno-lint-ignore no-explicit-any
    const couples = new Map<string, any[]>();
    for (const m of members) {
      if (!m.wedding_date || !mds.includes(m.wedding_date.slice(5))) continue;
      const k = `${m.family_id || m.id}|${m.wedding_date}`;
      (couples.get(k) || couples.set(k, []).get(k))!.push(m);
    }
    for (const [k, ms] of couples) {
      ms.sort((a, b) => (a.relationship === "Head" ? -1 : b.relationship === "Head" ? 1 : 0));
      const firsts = ms.map((m) => m.first_name), fulls = ms.map((m) => `${m.first_name} ${m.last_name}`);
      const sameLast = ms.every((m) => m.last_name === ms[0].last_name);
      const couple = ms.length === 2 && sameLast ? `${firsts.join(" & ")} ${ms[0].last_name}` : fulls.join(" & ");
      const wy = Number(ms[0].wedding_date.slice(0, 4)), n = year - wy;
      let emails = [...new Set(ms.map((m) => mail(m.email)).filter(ok))];
      const optedCouple = ms.some((m) => opted.has(mail(m.email)));
      if (!emails.length && ms[0].family_id) emails = [...new Set((byFamily.get(ms[0].family_id) || []).filter((x) => ADULT.has(x.relationship)).map((x) => mail(x.email)).filter(ok))];
      items.push({
        id: `anniversary:${k}:${year}`, kind: "anniversary", key: k, date, name: couple,
        vars: { couple, couple_first: firsts.join(" & "), first_name: firsts.join(" & "), name: couple, years: wy > 1900 && n > 0 ? ordinal(n) : "" },
        emails, via_family: false, opted_out: optedCouple && !emails.length, status: null, sent_at: null, error: null,
      });
    }
  }
  if (items.length) {
    const years = [...new Set(days.map((d) => d.year))];
    const { data: sent } = await admin.from("greeting_deliveries").select("kind, occasion_key, year, status, sent_at, error").in("year", years);
    // deno-lint-ignore no-explicit-any
    const idx = new Map((sent || []).map((s: any) => [`${s.kind}:${s.occasion_key}:${s.year}`, s]));
    for (const it of items) {
      // deno-lint-ignore no-explicit-any
      const s: any = idx.get(it.id);
      if (s) { it.status = s.status; it.sent_at = s.sent_at; it.error = s.error; }
    }
  }
  return items;
}

const fill = (t: string, v: Record<string, string>) =>
  String(t || "").replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/\s+([,.!])/g, "$1").replace(/ {2,}/g, " ");

function renderEmail(kind: string, tpl: Tpl, v: Record<string, string>, opts: { site: string; unsub: string; test?: boolean; church: string; address: string }) {
  const paras = (t: string) => esc(fill(t, v)).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const accent = kind === "birthday" ? "#c09243" : "#8a5a2c";
  const label = kind === "birthday" ? "Happy Birthday" : "Happy Anniversary";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4efe7;font:16px/1.6 Georgia,'Times New Roman',serif;color:#1d1915">
${opts.test ? `<div style="background:#fff6e6;color:#7a5a12;text-align:center;padding:8px;font:13px -apple-system,Segoe UI,Arial,sans-serif">Test copy — only you received this.</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border-radius:14px;overflow:hidden;border:1px solid #e6d8bf">
<tr><td style="padding:22px 28px 0;text-align:center">
  <img src="${esc(opts.site)}/assets/newsletter/logo.png" width="52" height="52" alt="" style="display:inline-block">
  <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b5a4a;margin-top:6px">${esc(opts.church)}</div>
  <div style="font-size:30px;line-height:1.2;color:${accent};margin:14px 0 4px;font-weight:bold">${label}</div>
  <div style="width:56px;height:3px;background:${accent};margin:10px auto 0"></div>
</td></tr>
${tpl.image_url ? `<tr><td style="padding:20px 28px 0"><img src="${esc(tpl.image_url)}" width="504" alt="" style="display:block;width:100%;height:auto;border-radius:10px"></td></tr>` : ""}
<tr><td style="padding:22px 32px 6px">
  ${paras(tpl.message || "")}
  <p style="margin:18px 0 0">${esc(fill(tpl.signoff || "", v)).replace(/\n/g, "<br>")}</p>
</td></tr>
<tr><td style="padding:18px 28px 22px;border-top:1px solid #efe4d2;font:12px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#7a6b5c;text-align:center">
  ${esc(opts.church)} · ${esc(opts.address)}<br>
  <a href="${esc(opts.unsub)}" style="color:#7a6b5c">Don’t want greeting emails? Unsubscribe</a>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${fill(tpl.message || "", v)}\n\n${fill(tpl.signoff || "", v)}\n\n${opts.church} · ${opts.address}\nUnsubscribe from greetings: ${opts.unsub}`;
  return { subject: fill(tpl.subject || label, v), html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

    // Who is calling: the daily job (cron key) or a signed-in officer/admin
    let caller: { email?: string } | null = null, isCron = false;
    const cronKey = req.headers.get("x-cron-key");
    if (cronKey) {
      const { data } = await admin.from("app_secrets").select("value").eq("key", "cron").maybeSingle();
      isCron = !!data && data.value === cronKey;
    } else {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(token);
      if (user) {
        const { data: m } = await admin.from("members").select("role, email").eq("auth_user_id", user.id).maybeSingle();
        if (m && ["officer", "admin"].includes(m.role)) caller = { email: m.email || user.email || "" };
      }
    }
    if (!isCron && !caller) return json({ error: "Only officers can send greetings." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = isCron ? "auto" : body.action;
    const site = SITE_OK.some((r) => r.test(String(body.site_base || ""))) ? String(body.site_base) : SITE_DEFAULT;

    const [{ data: gRow }, { data: nRow }, { data: secretRow }] = await Promise.all([
      admin.from("portal_settings").select("value").eq("key", "greetings").maybeSingle(),
      admin.from("portal_settings").select("value").eq("key", "newsletter").maybeSingle(),
      admin.from("app_secrets").select("value").eq("key", "newsletter_unsubscribe").maybeSingle(),
    ]);
    const G = (gRow?.value || {}) as { auto?: boolean; birthday?: Tpl; anniversary?: Tpl };
    const S = (nRow?.value || {}) as { from_name?: string; from_email?: string; reply_to?: string; church_address?: string };
    const church = S.from_name || "Mar Thoma Church, Atlanta";
    const address = S.church_address || "6015 Old Stone Mountain Rd, Stone Mountain, GA 30087";
    const secret = secretRow?.value || "";
    const RESEND = Deno.env.get("RESEND_API_KEY");
    const tplFor = (kind: string, override?: Tpl): Tpl => ({ ...((kind === "birthday" ? G.birthday : G.anniversary) || {}), ...(override || {}) });

    async function build(kind: string, tpl: Tpl, v: Record<string, string>, to: string, test = false) {
      const t = await hmac(secret, `greetings:${to}`);
      const unsub = `${site}/newsletters/unsubscribe/?l=greetings&e=${encodeURIComponent(to)}&t=${t}`;
      const oneClick = `${SB_URL}/functions/v1/newsletter-unsubscribe?l=greetings&e=${encodeURIComponent(to)}&t=${t}`;
      return { ...renderEmail(kind, tpl, { church, ...v }, { site, unsub, test, church, address }), oneClick };
    }
    async function deliver(to: string[], msg: { subject: string; html: string; text: string; oneClick: string }, test = false) {
      if (!RESEND) return "Email sending isn't set up yet (RESEND_API_KEY is missing in Supabase).";
      const payload: Record<string, unknown> = {
        from: `${church} <${S.from_email || "news@mtcatlanta.org"}>`, to, subject: `${test ? "[Test] " : ""}${msg.subject}`,
        html: msg.html, text: msg.text,
        headers: { "List-Unsubscribe": `<${msg.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
      if (S.reply_to) payload.reply_to = S.reply_to;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (r.ok) return null;
        const err = await r.json().catch(() => ({}));
        if (r.status === 429 && attempt < 2) { await sleep(1200); continue; }
        return String(err.message || err.error || `Resend error ${r.status}`);
      }
      return "Too many requests";
    }
    async function sendItems(items: Item[], by: string) {
      const results: { id: string; status: string; error?: string }[] = [];
      for (const it of items.slice(0, BATCH)) {
        if (it.status === "sent" || !it.emails.length) continue;
        // One email per couple (both addresses on it); one per birthday (parents together if sent to them).
        const msg = await build(it.kind, tplFor(it.kind), it.vars, it.emails[0]);
        const err = await deliver(it.emails, msg);
        const year = Number(it.date.slice(0, 4));
        await admin.from("greeting_deliveries").upsert({
          kind: it.kind, occasion_key: it.key, year, celebrant: it.name, emails: it.emails,
          status: err ? "failed" : "sent", error: err, sent_by: by, sent_at: new Date().toISOString(),
        }, { onConflict: "kind,occasion_key,year" });
        results.push({ id: it.id, status: err ? "failed" : "sent", ...(err ? { error: err } : {}) });
        await sleep(GAP_MS);
      }
      return results;
    }
    const sample = (kind: string) => kind === "birthday"
      ? { first_name: "Mary", name: "Mary Thomas" }
      : { couple: "John & Mary Thomas", couple_first: "John & Mary", first_name: "John & Mary", name: "John & Mary Thomas", years: "25th" };

    if (action === "list") {
      const from = String(body.from || todayET()), to = String(body.to || from);
      const items = await celebrations(admin, from, to);
      return json({ items: items.map(({ vars, ...rest }) => ({ ...rest, years: vars.years || "" })), ready: !!RESEND, auto: !!G.auto, today: todayET() });
    }
    if (action === "render") {
      const kind = body.kind === "anniversary" ? "anniversary" : "birthday";
      const msg = await build(kind, tplFor(kind, body.template), sample(kind), caller?.email || "you@example.com");
      return json({ subject: msg.subject, html: msg.html });
    }
    if (action === "test") {
      const kind = body.kind === "anniversary" ? "anniversary" : "birthday";
      const to = String(body.to || caller?.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return json({ error: "Enter a valid email address for the test." }, 400);
      const err = await deliver([to], await build(kind, tplFor(kind, body.template), sample(kind), to, true), true);
      if (err) return json({ error: `The test email couldn't be sent: ${err}` }, 400);
      return json({ ok: true, message: `Test sent to ${to}.` });
    }
    if (action === "send") {
      const from = String(body.from || todayET()), to = String(body.to || from);
      const want = new Set((body.ids || []) as string[]);
      const items = (await celebrations(admin, from, to)).filter((it) => want.has(it.id) && it.status !== "sent" && it.emails.length);
      const results = await sendItems(items, "admin");
      return json({ ok: true, results, remaining: Math.max(0, items.length - results.length) });
    }
    if (action === "auto") {
      if (!G.auto) return json({ ok: true, skipped: "Automatic sending is off." });
      if (!RESEND) return json({ ok: true, skipped: "Resend is not set up." });
      const d = todayET();
      const items = (await celebrations(admin, d, d)).filter((it) => it.status !== "sent" && it.emails.length);
      const results: unknown[] = [];
      for (let i = 0; i < items.length; i += BATCH) results.push(...await sendItems(items.slice(i, i + BATCH), "auto"));
      return json({ ok: true, date: d, results });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
