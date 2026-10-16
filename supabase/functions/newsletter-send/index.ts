// Newsletter sending (Admin → Newsletters).
// Actions (caller must be signed in as an officer or admin):
//   stats  – how many people the newsletter will go to
//   test   – send one copy to an address (default: the caller)
//   send   – send the next batch; the admin page calls this repeatedly until remaining = 0
// Email goes out through Resend (secret RESEND_API_KEY). Each email has a summary, a link to the
// PDF, the PDF attached (unless very large) and a signed one-click unsubscribe link.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BATCH = 25;                       // emails per call (keeps each call well under the time limit)
const GAP_MS = 550;                     // Resend allows about 2 requests a second
const MAX_ATTACH = 8 * 1024 * 1024;     // larger PDFs go as a link only
const SITE_DEFAULT = "https://shajan-factor42.github.io/AtlantaMarthomaChurch";
const SITE_OK = [/^https:\/\/shajan-factor42\.github\.io\/AtlantaMarthomaChurch$/i, /^https:\/\/(www\.)?mtcatlanta\.org$/i];
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

type Content = {
  message?: string;
  events?: { title: string; when?: string; location?: string }[];
  announcements?: { title: string }[];
  sections?: { heading: string }[];
  attach_pdf?: boolean;
};

function emailHtml(nl: { title: string; pdf_url: string }, c: Content, church: { name: string; address: string }, unsubUrl: string, test: boolean, attached: boolean) {
  const para = (t: string) => esc(t).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const evs = (c.events || []).slice(0, 8);
  const anns = (c.announcements || []).slice(0, 8);
  const secs = (c.sections || []).filter((s) => s.heading).slice(0, 6);
  const li = (main: string, sub = "") => `<li style="margin:0 0 8px"><strong>${esc(main)}</strong>${sub ? `<br><span style="color:#5f6b78">${esc(sub)}</span>` : ""}</li>`;
  const block = (h: string, items: string) => items ? `<h3 style="font:600 16px Georgia,serif;color:#3d5875;margin:22px 0 8px">${h}</h3><ul style="padding-left:18px;margin:0">${items}</ul>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f7fa;font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2a36">
${test ? `<div style="background:#fff6e6;color:#7a5a12;text-align:center;padding:8px;font-size:13px">Test copy — only you received this.</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8ef">
<tr><td style="background:#4f6d8f;color:#fff;padding:26px 28px">
  <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#e8d3a6">Parish Newsletter</div>
  <div style="font:600 26px Georgia,serif;margin-top:4px">${esc(nl.title)}</div>
  <div style="font-size:14px;opacity:.85;margin-top:2px">${esc(church.name)}</div>
</td></tr>
<tr><td style="padding:26px 28px 8px">
  ${c.message ? para(c.message) : `<p style="margin:0 0 14px">Dear friends, the ${esc(nl.title)} newsletter is ready.</p>`}
  ${block("Coming up", evs.map((e) => li(e.title, [e.when, e.location].filter(Boolean).join(" · "))).join(""))}
  ${block("Announcements", anns.map((a) => li(a.title)).join(""))}
  ${block("Also inside", secs.map((s) => li(s.heading)).join(""))}
  <p style="margin:26px 0 10px;text-align:center"><a href="${esc(nl.pdf_url)}" style="display:inline-block;background:#c09243;color:#1f2a36;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Read the full newsletter (PDF)</a></p>
  ${attached ? `<p style="margin:0 0 18px;text-align:center;font-size:13px;color:#5f6b78">The PDF is also attached to this email.</p>` : `<div style="height:12px"></div>`}
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #e2e8ef;font-size:12px;color:#5f6b78;line-height:1.5">
  ${esc(church.name)} · ${esc(church.address)}<br>
  You receive this as a member or friend of the parish. <a href="${esc(unsubUrl)}" style="color:#5f6b78">Unsubscribe</a>
</td></tr></table></td></tr></table></body></html>`;
}

function emailText(nl: { title: string; pdf_url: string }, c: Content, church: { name: string; address: string }, unsubUrl: string) {
  const lines = [`${church.name} — ${nl.title} newsletter`, "", c.message || `The ${nl.title} newsletter is ready.`, ""];
  if (c.events?.length) lines.push("Coming up:", ...c.events.slice(0, 8).map((e) => `- ${e.title}${e.when ? ` (${e.when})` : ""}`), "");
  if (c.announcements?.length) lines.push("Announcements:", ...c.announcements.slice(0, 8).map((a) => `- ${a.title}`), "");
  lines.push(`Read the full newsletter: ${nl.pdf_url}`, "", `${church.name} · ${church.address}`, `Unsubscribe: ${unsubUrl}`);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Please sign in again." }, 401);
    const { data: caller } = await admin.from("members").select("role, email").eq("auth_user_id", user.id).maybeSingle();
    if (!caller || !["officer", "admin"].includes(caller.role)) return json({ error: "Only officers can send newsletters." }, 403);

    const body = await req.json();
    const { action, newsletter_id } = body;
    const site = SITE_OK.some((r) => r.test(String(body.site_base || ""))) ? String(body.site_base) : SITE_DEFAULT;

    const { data: nl } = await admin.from("newsletters").select("*").eq("id", newsletter_id).maybeSingle();
    if (!nl) return json({ error: "Newsletter not found." }, 404);

    // ---------- Who it goes to ----------
    const [{ data: mems }, { data: subs }, { data: outs }] = await Promise.all([
      admin.from("members").select("email, first_name, family:families(status)").not("email", "is", null),
      admin.from("newsletter_subscribers").select("email, name"),
      admin.from("newsletter_optouts").select("email"),
    ]);
    const optedOut = new Set((outs || []).map((o) => o.email.toLowerCase()));
    const list = new Map<string, string>();
    let memberCount = 0, subCount = 0;
    for (const m of mems || []) {
      const e = String(m.email).trim().toLowerCase();
      // deno-lint-ignore no-explicit-any
      if (!EMAIL_RE.test(e) || (m as any).family?.status === "inactive" || optedOut.has(e) || list.has(e)) continue;
      list.set(e, m.first_name || ""); memberCount++;
    }
    for (const s of subs || []) {
      const e = String(s.email).trim().toLowerCase();
      if (!EMAIL_RE.test(e) || optedOut.has(e) || list.has(e)) continue;
      list.set(e, s.name || ""); subCount++;
    }
    const { data: done } = await admin.from("newsletter_deliveries").select("email, status").eq("newsletter_id", nl.id);
    const sentSet = new Set((done || []).filter((d) => d.status === "sent").map((d) => d.email));
    const failed = (done || []).filter((d) => d.status === "failed").length;
    const pending = [...list.keys()].filter((e) => !sentSet.has(e));

    if (action === "stats") {
      return json({ members: memberCount, subscribers: subCount, opted_out: optedOut.size, total: list.size, sent: sentSet.size, failed, remaining: pending.length, ready: !!Deno.env.get("RESEND_API_KEY") });
    }

    // ---------- Sending ----------
    const RESEND = Deno.env.get("RESEND_API_KEY");
    if (!RESEND) return json({ error: "Email sending isn't set up yet: the RESEND_API_KEY secret is missing in Supabase." }, 400);
    if (!nl.pdf_url) return json({ error: "Create or upload the PDF before sending." }, 400);

    const [{ data: setRow }, { data: secretRow }] = await Promise.all([
      admin.from("portal_settings").select("value").eq("key", "newsletter").maybeSingle(),
      admin.from("app_secrets").select("value").eq("key", "newsletter_unsubscribe").maybeSingle(),
    ]);
    const cfg = (setRow?.value || {}) as { from_name?: string; from_email?: string; reply_to?: string; church_address?: string };
    const from = `${cfg.from_name || "Mar Thoma Church, Atlanta"} <${cfg.from_email || "news@mtcatlanta.org"}>`;
    const church = { name: cfg.from_name || "Mar Thoma Church, Atlanta", address: cfg.church_address || "6015 Old Stone Mountain Rd, Stone Mountain, GA 30087" };
    const secret = secretRow?.value || "";
    const c = (nl.content || {}) as Content;

    // PDF attachment (fetched once per call)
    let attachment: { filename: string; content: string } | null = null;
    if (c.attach_pdf !== false) {
      const r = await fetch(nl.pdf_url);
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length <= MAX_ATTACH) attachment = { filename: `MTCA Newsletter - ${nl.title}.pdf`.replace(/[^\w .()-]+/g, ""), content: toBase64(bytes) };
      }
    }

    async function sendOne(email: string, test: boolean) {
      const t = await hmac(secret, email);
      const oneClick = `${SB_URL}/functions/v1/newsletter-unsubscribe?e=${encodeURIComponent(email)}&t=${t}`;
      const page = `${site}/newsletters/unsubscribe/?e=${encodeURIComponent(email)}&t=${t}`;
      const payload: Record<string, unknown> = {
        from, to: [email], subject: `${test ? "[Test] " : ""}${church.name} — ${nl.title} newsletter`,
        html: emailHtml(nl, c, church, page, test, !!attachment), text: emailText(nl, c, church, page),
        headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
      if (cfg.reply_to) payload.reply_to = cfg.reply_to;
      if (attachment) payload.attachments = [attachment];
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (r.ok) return null;
        const err = await r.json().catch(() => ({}));
        if (r.status === 429 && attempt < 2) { await sleep(1200); continue; }
        return String(err.message || err.error || `Resend error ${r.status}`);
      }
      return "Too many requests";
    }

    if (action === "test") {
      const to = String(body.test_email || caller.email || user.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return json({ error: "Enter a valid email address for the test." }, 400);
      const err = await sendOne(to, true);
      if (err) return json({ error: `The test email couldn't be sent: ${err}` }, 400);
      return json({ ok: true, message: `Test sent to ${to}.` });
    }

    if (action === "send") {
      if (nl.status === "sent" && !pending.length) return json({ ok: true, sent: sentSet.size, remaining: 0, failed });
      if (nl.status === "draft") await admin.from("newsletters").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", nl.id);
      const batch = pending.filter((e) => !(done || []).some((d) => d.email === e && d.status === "failed") || body.retry_failed).slice(0, BATCH);
      for (const email of batch) {
        const err = await sendOne(email, false);
        await admin.from("newsletter_deliveries").upsert({ newsletter_id: nl.id, email, status: err ? "failed" : "sent", error: err, sent_at: new Date().toISOString() });
        await sleep(GAP_MS);
      }
      const { data: after } = await admin.from("newsletter_deliveries").select("email, status").eq("newsletter_id", nl.id);
      const okSet = new Set((after || []).filter((d) => d.status === "sent").map((d) => d.email));
      const failSet = new Set((after || []).filter((d) => d.status === "failed").map((d) => d.email));
      const remaining = [...list.keys()].filter((e) => !okSet.has(e) && (body.retry_failed || !failSet.has(e))).length;
      if (!remaining) {
        await admin.from("newsletters").update({ status: "sent", sent_at: nl.sent_at || new Date().toISOString(), sent_count: okSet.size, published: true, updated_at: new Date().toISOString() }).eq("id", nl.id);
      }
      return json({ ok: true, sent: okSet.size, failed: failSet.size, remaining, total: list.size });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
