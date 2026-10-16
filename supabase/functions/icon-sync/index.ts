// IconCMO → portal sync (read-only toward ICON).
// Callers: an admin from Admin → Portal Settings (user JWT), or the nightly pg_cron job (x-cron-key).
// Actions:
//   status                         – credentials present?, settings, last runs
//   test   {source}                – sign in to ICON and count households
//   pull   {source, part, ...}     – copy ICON data into the private icon_* staging tables
//            part "start"           clears staging
//            part "membership"      households + members + pledges
//            part "contributions"   posted gifts for {year}, {startAt} (returns next startAt until done)
//   merge  {from, to, dry}        – fold staging into families/members/contributions/pledges (dry = preview + roll back)
//   nightly                        – (cron) live pull of membership + this and last year's gifts, then merge
// source "test" = Icon's public developer database; it is only ever merged as a dry run.
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

// The merge can take longer than the API's 8-second query limit, so it runs over a direct database connection.
async function runMerge(from: string | null, to: string | null, dry: boolean) {
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false, idle_timeout: 5 });
  try {
    await sql`set statement_timeout = '140s'`;
    const rows = await sql`select public.icon_merge(${from}::date, ${to}::date, ${dry}) as r`;
    return rows[0].r;
  } finally { await sql.end({ timeout: 5 }); }
}
async function clearStaging() {
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false, idle_timeout: 5 });
  try { await sql`truncate public.icon_contributions, public.icon_pledges, public.icon_members, public.icon_households`; }
  finally { await sql.end({ timeout: 5 }); }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const API = "https://secure1.iconcmo.com/api/";
const TEST = { Phone: "5555555555", Username: "JoePUser", Password: "password" };
const PAGE = 1000;
const PAGES_PER_CALL = 8;           // keeps each call well inside the time limit

type Auth = { Phone: string; Username: string; Password: string };
// deno-lint-ignore no-explicit-any
type Any = any;

function liveAuth(): Auth | null {
  const Phone = Deno.env.get("ICON_PHONE"), Username = Deno.env.get("ICON_USERNAME"), Password = Deno.env.get("ICON_PASSWORD");
  return Phone && Username && Password ? { Phone: Phone.replace(/\D/g, ""), Username, Password } : null;
}

async function icon(auth: Auth, Module: string, Section: string, Filters: Record<string, unknown> = {}) {
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Auth: auth, Request: { Module, Section, Filters } }) });
    const text = await r.text();
    let data: Any = null;
    try { data = JSON.parse(text); } catch { lastErr = `ICON returned an unexpected reply (${r.status}).`; }
    if (data) {
      const key = Object.keys(data).find((k) => Array.isArray(data[k]));
      if (key) return { rows: data[key] as Any[], records: Number(data.statistics?.records ?? data[key].length), permissions: data.permissions, role: data.role };
      lastErr = String(data.error || data.message || data.errors?.[0] || `ICON said no to ${Module}/${Section}.`);
      if (/login|password|auth|permission|credential/i.test(lastErr)) break;   // don't retry bad credentials
    }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  throw new Error(lastErr || "Could not reach ICON.");
}

async function pullAll(auth: Auth, Module: string, Section: string, Filters: Record<string, unknown> = {}) {
  const out: Any[] = [];
  // Page until ICON returns a short page ("records" is the total for some sections, the page size for others)
  for (let startAt = 0, pages = 0; pages < 200; startAt += PAGE, pages++) {
    const { rows } = await icon(auth, Module, Section, { ...Filters, startAt, limit: PAGE });
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function stage(sb: any, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // ---- Who is calling ----
    let isCron = false, isAdmin = false;
    const cronKey = req.headers.get("x-cron-key");
    if (cronKey) {
      const { data } = await sb.from("app_secrets").select("value").eq("key", "cron").maybeSingle();
      isCron = !!data && data.value === cronKey;
    } else {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await sb.auth.getUser(token);
      if (user) {
        const { data: m } = await sb.from("members").select("role").eq("auth_user_id", user.id).maybeSingle();
        isAdmin = !!m && m.role === "admin";
      }
    }
    if (!isCron && !isAdmin) return json({ error: "Only an admin can manage the ICON connection." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = isCron ? (body.action || "nightly") : body.action;   // server-side calls may name an action
    const { data: setRow } = await sb.from("portal_settings").select("value").eq("key", "icon").maybeSingle();
    const settings = (setRow?.value || {}) as { enabled?: boolean; giving_from_icon?: boolean; start_year?: number };
    const live = liveAuth();
    const source = body.source === "live" ? "live" : "test";
    const auth = source === "live" ? live : TEST;

    if (action === "status") {
      const { data: runs } = await sb.from("icon_sync_runs").select("*").order("started_at", { ascending: false }).limit(8);
      return json({ live_configured: !!live, settings, runs: runs || [] });
    }
    if (!auth) return json({ error: "The church's ICON login hasn't been added yet (ICON_PHONE, ICON_USERNAME, ICON_PASSWORD secrets in Supabase)." }, 400);

    if (action === "test") {
      const h = await icon(auth, "membership", "households", { limit: 1 });
      const m = await icon(auth, "membership", "members", { limit: 1 });
      const y = new Date().getFullYear();
      let gifts: number | string = "?";
      try { gifts = (await icon(auth, "contributions", "posted", { begin_date: `${y}-01-01`, end_date: `${y}-12-31`, limit: 1 })).records; }
      catch (e) { gifts = `not allowed (${(e as Error).message})`; }
      return json({ ok: true, source, households: h.records, has_members: m.rows.length > 0, gifts_this_year: gifts, role: h.role, permissions: h.permissions });
    }

    if (action === "pull") {
      const part = body.part;
      if (part === "start") {
        await clearStaging();
        return json({ ok: true });
      }
      if (part === "membership") {
        const [hh, mm, pp] = await Promise.all([
          pullAll(auth, "membership", "households"),
          pullAll(auth, "membership", "members"),
          pullAll(auth, "contributions", "pledges").catch(() => [] as Any[]),
        ]);
        await stage(sb, "icon_households", hh.map((d) => ({ id: String(d.id), data: d, source })));
        await stage(sb, "icon_members", mm.map((d) => ({ id: String(d.id), household_id: d.household_id ? String(d.household_id) : null, data: d, source })));
        await stage(sb, "icon_pledges", pp.map((d) => ({ id: String(d.id), household_id: d.household_id ? String(d.household_id) : null, data: d, source })));
        return json({ ok: true, households: hh.length, members: mm.length, pledges: pp.length });
      }
      if (part === "contributions") {
        const year = Number(body.year) || new Date().getFullYear();
        let startAt = Number(body.startAt) || 0, records = 0, got = 0;
        for (let i = 0; i < PAGES_PER_CALL; i++) {
          const r = await icon(auth, "contributions", "posted", { begin_date: `${year}-01-01`, end_date: `${year}-12-31`, startAt, limit: PAGE });
          records = r.records;
          await stage(sb, "icon_contributions", r.rows.map((d: Any) => ({
            id: String(d.id), household_id: d.household_id ? String(d.household_id) : null,
            date_given: (d.date_given || d.batch_date || `${year}-01-01`).slice(0, 10), data: d, source,
          })));
          got += r.rows.length; startAt += PAGE;
          if (r.rows.length < PAGE) { startAt = -1; break; }
        }
        return json({ ok: true, year, staged: got, records, next: startAt });   // next = -1 when the year is done
      }
      return json({ error: "Unknown part." }, 400);
    }

    if (action === "merge") {
      const dry = body.dry !== false || source !== "live";
      const run = await sb.from("icon_sync_runs").insert({ source, dry_run: dry, trigger: isCron ? "server" : "admin" }).select("id").single();
      let data = null, error: string | null = null;
      try { data = await runMerge(body.from || null, body.to || null, dry); } catch (e) { error = (e as Error).message; }
      await sb.from("icon_sync_runs").update({ finished_at: new Date().toISOString(), ok: !error, summary: data, error }).eq("id", run.data?.id);
      if (error) throw new Error(error);
      return json({ ok: true, summary: data });
    }

    if (action === "nightly") {
      if (!settings.enabled) return json({ ok: true, skipped: "Nightly ICON sync is off." });
      if (!live) return json({ ok: true, skipped: "ICON login not set." });
      const run = await sb.from("icon_sync_runs").insert({ source: "live", dry_run: false, trigger: "nightly" }).select("id").single();
      try {
        await clearStaging();
        const [hh, mm, pp] = await Promise.all([pullAll(live, "membership", "households"), pullAll(live, "membership", "members"), pullAll(live, "contributions", "pledges").catch(() => [] as Any[])]);
        await stage(sb, "icon_households", hh.map((d) => ({ id: String(d.id), data: d, source: "live" })));
        await stage(sb, "icon_members", mm.map((d) => ({ id: String(d.id), household_id: d.household_id ? String(d.household_id) : null, data: d, source: "live" })));
        await stage(sb, "icon_pledges", pp.map((d) => ({ id: String(d.id), household_id: d.household_id ? String(d.household_id) : null, data: d, source: "live" })));
        const y = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric" }).format(new Date()));
        for (const year of [y - 1, y]) {
          const gifts = await pullAll(live, "contributions", "posted", { begin_date: `${year}-01-01`, end_date: `${year}-12-31` });
          await stage(sb, "icon_contributions", gifts.map((d) => ({ id: String(d.id), household_id: d.household_id ? String(d.household_id) : null, date_given: (d.date_given || d.batch_date).slice(0, 10), data: d, source: "live" })));
        }
        const data = await runMerge(`${y - 1}-01-01`, `${y}-12-31`, false);
        await sb.from("icon_sync_runs").update({ finished_at: new Date().toISOString(), ok: true, summary: data }).eq("id", run.data?.id);
        return json({ ok: true, summary: data });
      } catch (e) {
        await sb.from("icon_sync_runs").update({ finished_at: new Date().toISOString(), ok: false, error: (e as Error).message }).eq("id", run.data?.id);
        throw e;
      }
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
