// "New Members" form on the website → saved for Admin → New Members, and emailed to the Vicar & Secretary.
// Public endpoint (no login). Spam protection: allowed origins only, a hidden honeypot field,
// a minimum fill time, and a per-visitor hourly limit.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITES: Record<string, string> = {
  "https://shajan-factor42.github.io": "https://shajan-factor42.github.io/AtlantaMarthomaChurch",
  "https://mtcatlanta.org": "https://mtcatlanta.org",
  "https://www.mtcatlanta.org": "https://mtcatlanta.org",
};
const RELS = ["Spouse", "Son", "Daughter", "Father", "Mother", "Grandparent", "Sibling", "Other"];
const ORGS = ["Sunday School", "Yuvajana Sakhyam", "Youth Fellowship", "Sevika Sangham", "Edavaka Mission", "Choir", "Senior Fellowship", "Prayer groups"];

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ymd = (v: unknown) => { const s = str(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const d = new Date(s + "T12:00:00Z"); return isNaN(+d) || d.getUTCFullYear() < 1900 || d > new Date(Date.now() + 864e5) ? null : s; };
const fmtDate = (s: string | null) => s ? new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

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
    // Bots: honeypot filled in, or form sent impossibly fast → pretend success, store nothing
    if (str(b.website) || (Number(b.elapsed_ms) > 0 && Number(b.elapsed_ms) < 2500)) return json({ ok: true });

    const r = {
      first_name: str(b.first_name, 80), last_name: str(b.last_name, 80), email: str(b.email, 160).toLowerCase(),
      phone: str(b.phone, 40) || null,
      address_line1: str(b.address_line1, 160) || null, address_line2: str(b.address_line2, 160) || null,
      city: str(b.city, 80) || null, state: str(b.state, 2).toUpperCase() || null, zip: str(b.zip, 10) || null,
      wedding_date: ymd(b.wedding_date), moved_on: ymd(b.moved_on),
      home_parish: str(b.home_parish, 200) || null, previous_parish: str(b.previous_parish, 200) || null,
      transfer_letter: ["yes", "requested", "no", "unsure"].includes(str(b.transfer_letter)) ? str(b.transfer_letter) : null,
      organizations: (Array.isArray(b.organizations) ? b.organizations : []).map((o: unknown) => str(o, 60)).filter((o: string) => ORGS.includes(o)),
      heard_from: str(b.heard_from, 200) || null, message: text(b.message, 2000) || null,
      family: (Array.isArray(b.family) ? b.family : []).slice(0, 10).map((f: Record<string, unknown>) => ({
        first_name: str(f?.first_name, 80), last_name: str(f?.last_name, 80),
        relationship: RELS.includes(str(f?.relationship)) ? str(f?.relationship) : "Other", date_of_birth: ymd(f?.date_of_birth),
      })).filter((f: { first_name: string }) => f.first_name),
    };
    if (!r.first_name || !r.last_name) return json({ error: "Please enter your first and last name." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) return json({ error: "Please enter a valid email address." }, 400);
    if (!r.phone) return json({ error: "Please enter a phone number so Achen can reach you." }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: setRow } = await sb.from("portal_settings").select("value").eq("key", "new_members").maybeSingle();
    const cfg = { enabled: true, recipients: ["vicar@mtcatlanta.org", "secretary@mtcatlanta.org"], ...(setRow?.value || {}) };
    if (cfg.enabled === false) return json({ error: "The form is closed right now. Please email the church office." }, 503);

    // At most 5 submissions per visitor per hour
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
    const { data: allowed } = await sb.rpc("chat_hit", { p_bucket: "nm:" + (await sha(ip + hour.toISOString().slice(0, 10))), p_window: hour.toISOString(), p_limit: 5 });
    if (allowed === false) return json({ error: "We’ve already received several forms from you. Please try again later or email the church office." }, 429);

    const { data: row, error } = await sb.from("new_member_requests").insert(r).select("id, created_at").single();
    if (error) throw error;

    // Email the Vicar & Secretary
    let emailStatus = "not configured";
    const RESEND = Deno.env.get("RESEND_API_KEY");
    const to = (cfg.recipients || []).filter((e: string) => /@/.test(e)).slice(0, 10);
    if (RESEND && to.length) {
      const { data: nRow } = await sb.from("portal_settings").select("value").eq("key", "newsletter").maybeSingle();
      const S = (nRow?.value || {}) as { from_name?: string; from_email?: string };
      const name = `${r.first_name} ${r.last_name}`;
      const address = [r.address_line1, r.address_line2, [r.city, r.state].filter(Boolean).join(", ") + (r.zip ? " " + r.zip : "")].filter((x) => x && x.trim()).join("<br>");
      const fam = r.family.length ? r.family.map((f: Record<string, string | null>) => `<li>${esc(f.first_name)} ${esc(f.last_name || r.last_name)} — ${esc(f.relationship)}${f.date_of_birth ? `, born ${esc(fmtDate(f.date_of_birth))}` : ""}</li>`).join("") : "<li>—</li>";
      const tr = (k: string, v: string) => v ? `<tr><td style="padding:6px 14px 6px 0;color:#667;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0">${v}</td></tr>` : "";
      const adminUrl = `${base}/admin/#newmembers`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2a36;max-width:620px">
        <h2 style="font-family:Georgia,serif;color:#3d5a7a;margin:0 0 4px">New member request</h2>
        <p style="margin:0 0 16px;color:#667">Submitted on the church website, ${esc(new Date(row.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "short" }))}</p>
        <table style="border-collapse:collapse;font-size:15px">
          ${tr("Name", `<strong>${esc(name)}</strong>`)}${tr("Email", `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`)}${tr("Phone", `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>`)}
          ${tr("Address", address)}${tr("Wedding date", esc(fmtDate(r.wedding_date)))}
          ${tr("Home parish (India)", esc(r.home_parish))}${tr("Previous parish", esc(r.previous_parish))}
          ${tr("Moved to Atlanta", esc(fmtDate(r.moved_on)))}${tr("Transfer letter", esc(r.transfer_letter))}
          ${tr("Interested in", esc(r.organizations.join(", ")))}${tr("Heard about us", esc(r.heard_from))}
        </table>
        <h3 style="margin:18px 0 6px;font-size:15px">Family members</h3><ul style="margin:0;padding-left:20px">${fam}</ul>
        ${r.message ? `<h3 style="margin:18px 0 6px;font-size:15px">Message</h3><p style="margin:0;white-space:pre-wrap">${esc(r.message)}</p>` : ""}
        <p style="margin:24px 0 0"><a href="${adminUrl}" style="background:#3d5a7a;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open in Admin</a></p>
        <p style="margin:16px 0 0;color:#889;font-size:13px">Reply to this email to write to ${esc(r.first_name)} directly.</p></div>`;
      const plain = `New member request — ${name}\nEmail: ${r.email}\nPhone: ${r.phone}\n` +
        `${r.address_line1 ? `Address: ${[r.address_line1, r.address_line2, r.city, r.state, r.zip].filter(Boolean).join(", ")}\n` : ""}` +
        `${r.home_parish ? `Home parish: ${r.home_parish}\n` : ""}${r.previous_parish ? `Previous parish: ${r.previous_parish}\n` : ""}` +
        `Family: ${r.family.map((f: Record<string, string>) => `${f.first_name} (${f.relationship})`).join(", ") || "—"}\n${r.message ? `\nMessage:\n${r.message}\n` : ""}\nOpen in Admin: ${adminUrl}`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `${S.from_name || "Mar Thoma Church, Atlanta"} website <${S.from_email || "news@mtcatlanta.org"}>`, to, reply_to: r.email, subject: `New member request: ${name}`, html, text: plain }),
      });
      emailStatus = res.ok ? "sent" : `failed: ${String((await res.json().catch(() => ({}))).message || res.status).slice(0, 180)}`;
      if (!res.ok) console.error("resend", emailStatus);
    }
    await sb.from("new_member_requests").update({ email_status: emailStatus }).eq("id", row.id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Sorry — something went wrong. Please try again, or email the church office." }, 500);
  }
});
