// Prayer requests from the website → saved privately for the Vicar (Admin → Prayer Requests) and emailed to him.
// Public endpoint. Anonymous requests store no name or contact details at all.
// Spam protection: allowed origins only, honeypot field, minimum fill time, 5 per visitor per hour.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITES: Record<string, string> = {
  "https://shajan-factor42.github.io": "https://shajan-factor42.github.io/AtlantaMarthomaChurch",
  "https://mtcatlanta.org": "https://mtcatlanta.org",
  "https://www.mtcatlanta.org": "https://mtcatlanta.org",
};
const FOR = ["Myself", "My family", "A friend", "Someone else", "Our church", "Other"];
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const base = SITES[origin] || (/^http:\/\/localhost(:\d+)?$/.test(origin) ? SITES["https://shajan-factor42.github.io"] : "");
  const headers = {
    "Access-Control-Allow-Origin": base ? origin : "https://mtcatlanta.org",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json",
  };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!base) return json({ error: "This form only works on the church website." }, 403);

  try {
    const b = await req.json().catch(() => ({}));
    if (str(b.website) || (Number(b.elapsed_ms) > 0 && Number(b.elapsed_ms) < 2500)) return json({ ok: true });

    const anonymous = b.anonymous === true;
    const request = typeof b.request === "string" ? b.request.trim().slice(0, 3000) : "";
    if (request.length < 3) return json({ error: "Please write your prayer request." }, 400);
    const r = {
      anonymous,
      name: anonymous ? null : str(b.name, 120) || null,
      email: anonymous ? null : str(b.email, 160).toLowerCase() || null,
      phone: anonymous ? null : str(b.phone, 40) || null,
      for_whom: FOR.includes(str(b.for_whom)) ? str(b.for_whom) : null,
      request,
      share_ok: b.share_ok === true,
      wants_contact: !anonymous && b.wants_contact === true,
    };
    if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) return json({ error: "Please check your email address, or leave it blank." }, 400);
    if (r.wants_contact && !r.email && !r.phone) return json({ error: "Please add an email or phone number so Achen can reach you." }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: setRow } = await sb.from("portal_settings").select("value").eq("key", "prayer").maybeSingle();
    const cfg = { enabled: true, recipients: ["vicar@mtcatlanta.org"], ...(setRow?.value || {}) };
    if (cfg.enabled === false) return json({ error: "Prayer requests can’t be sent online right now. Please call or email the Vicar." }, 503);

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
    const { data: allowed } = await sb.rpc("chat_hit", { p_bucket: "pr:" + (await sha(ip + hour.toISOString().slice(0, 10))), p_window: hour.toISOString(), p_limit: 5 });
    if (allowed === false) return json({ error: "We’ve received several requests from you already. Please try again later, or call the Vicar." }, 429);

    const { data: row, error } = await sb.from("prayer_requests").insert(r).select("id, created_at").single();
    if (error) throw error;

    let emailStatus = "not configured";
    const RESEND = Deno.env.get("RESEND_API_KEY");
    const to = (cfg.recipients || []).filter((e: string) => /@/.test(e)).slice(0, 5);
    if (RESEND && to.length) {
      const { data: nRow } = await sb.from("portal_settings").select("value").eq("key", "newsletter").maybeSingle();
      const S = (nRow?.value || {}) as { from_name?: string; from_email?: string };
      const who = anonymous ? "Anonymous" : (r.name || "Name not given");
      const tr = (k: string, v: string) => v ? `<tr><td style="padding:5px 14px 5px 0;color:#667;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:5px 0">${v}</td></tr>` : "";
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2a36;max-width:620px">
        <h2 style="font-family:Georgia,serif;color:#3d5a7a;margin:0 0 4px">Prayer request</h2>
        <p style="margin:0 0 16px;color:#667">From the church website, ${esc(new Date(row.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "short" }))}</p>
        <div style="background:#f5f2ea;border-left:4px solid #c09243;padding:14px 16px;border-radius:6px;white-space:pre-wrap">${esc(r.request)}</div>
        <table style="border-collapse:collapse;margin-top:16px">
          ${tr("From", `<strong>${esc(who)}</strong>`)}${tr("For", esc(r.for_whom || ""))}
          ${tr("Email", r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : "")}${tr("Phone", r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : "")}
          ${tr("Would like a call", r.wants_contact ? "Yes" : "")}
          ${tr("Sharing", r.share_ok ? "May be included in intercessions / prayer group (without names)" : "Keep private")}
        </table>
        <p style="margin:22px 0 0"><a href="${base}/admin/#prayer" style="background:#3d5a7a;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open in Admin</a></p></div>`;
      const plain = `Prayer request — ${who}\n\n${r.request}\n\n${r.for_whom ? `For: ${r.for_whom}\n` : ""}${r.email ? `Email: ${r.email}\n` : ""}${r.phone ? `Phone: ${r.phone}\n` : ""}${r.wants_contact ? "Would like a call: yes\n" : ""}Sharing: ${r.share_ok ? "may be included without names" : "keep private"}\n`;
      const payload: Record<string, unknown> = { from: `${S.from_name || "Mar Thoma Church, Atlanta"} website <${S.from_email || "news@mtcatlanta.org"}>`, to, subject: `Prayer request${anonymous ? " (anonymous)" : r.name ? ` from ${r.name}` : ""}`, html, text: plain };
      if (r.email) payload.reply_to = r.email;
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      emailStatus = res.ok ? "sent" : `failed: ${String((await res.json().catch(() => ({}))).message || res.status).slice(0, 180)}`;
    }
    await sb.from("prayer_requests").update({ email_status: emailStatus }).eq("id", row.id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Sorry — something went wrong. Please try again, or call the Vicar." }, 500);
  }
});
