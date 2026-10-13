// Mitra AI reference sources: keeps a searchable copy of marthoma.in (lectionary,
// Kalpanas/circulars incl. PDF text, key pages, news) plus any extra pages admins add.
// Triggered hourly by pg_cron (x-cron-key header) or by an officer from Admin (user JWT).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getDocumentProxy } from "npm:unpdf@0.12.1";

const UA = "Mozilla/5.0 (compatible; MitraAI/1.0; Mar Thoma Church Atlanta website assistant; +https://mtcatlanta.org)";
const MT = "https://marthoma.in";
const MT_PAGES = [
  "/overview/", "/history/", "/about-parish/", "/office-bearers/", "/vicar-general/", "/central/", "/dioceses/",
  "/sabha-council/", "/organisations/", "/bishops/", "/institute/", "/publications/", "/contact-us/", "/events/",
  "/ecological-commission/", "/mar-thoma-vaidika-selection-committee/",
  "/mar-thomasunday-school-samajam/", "/mar-thoma-students-conference/", "/the-mar-thoma-yuvajana-sakhyam/",
  "/mar-thoma-suvishesha-sevika-sangam/", "/mar-thoma-evangelistic-association/",
  "/mar-thoma-voluntary-evangelists-association-mtvea/", "/marthoma-senior-citizen-fellowship/",
  "/department-of-sacred-music-and-communications/", "/malankara-marthoma-sabha-development-department/",
  "/marthoma-retired-clergy-fellowship/",
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/* ---------------- text helpers ---------------- */
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•" };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(n) ? m : String.fromCodePoint(n); }
  return ENT[e.toLowerCase()] ?? m;
});
function htmlToText(html: string): string {
  let h = html.replace(/<(script|style|noscript|svg|template|iframe|head|nav|header|footer|form|button|select)\b[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|table|ul|ol|figcaption)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\n## ")
    .replace(/<[^>]+>/g, " ");
  return decode(h).split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter((l) => l && l !== "•" && l !== "##").join("\n").replace(/\n{3,}/g, "\n\n");
}
const titleOf = (html: string) => decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim()).replace(/\s*[–|-]\s*Marthoma.*$/i, "").trim();

// Common English words: real text has lots of them, legacy-font Malayalam "gibberish" has almost none.
const COMMON = new Set(("the of and to in a is that for it as with be on by this are we our you your will all from at have has not his he him " +
  "they their them which was were been or an but who what when there one so can may also these those its it's into upon unto shall should would " +
  "us me my i do does done any each every more most other such only own same than then too very just over under about after before during " +
  "god lord jesus christ holy spirit church sunday worship prayer prayers service day days year members parish parishes vicar vicars " +
  "dear dearly beloved blessings greetings grace peace love faith hope life family families people world new year diocese dioceses " +
  "metropolitan bishop episcopa thirumeni sabha mandalam council circular kalpana organisation organisations offering offertory " +
  "special read reading readings please kindly request requested requests time also given give office bearers president secretary " +
  "treasurer members meeting elected election decision decisions amendment constitution suffragan youth children school schools " +
  "education evangelist evangelists association fellowship senior citizen sevika sangam sakhyam yuvajana mission ministry bible " +
  "word words community through together need needs support every year order part first second third along both how").split(/\s+/));

/** Keep the readable lines; decide if the document is usable at all. */
function cleanText(t: string): { text: string; status: "ok" | "empty" | "garbled" } {
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters < 80) return { text: "", status: "empty" };
  const ml = (t.match(/[\u0D00-\u0D7F]/g) || []).length;
  const keep: string[] = [];
  for (const line of t.split("\n")) {
    const l = line.trim(); if (!l) continue;
    const mlc = (l.match(/[\u0D00-\u0D7F]/g) || []).length;
    const words = l.toLowerCase().match(/[a-z']{2,}/g) || [];
    const hits = words.filter((w) => COMMON.has(w)).length;
    if (mlc > 3 && mlc >= l.length * 0.4) keep.push(l);                      // proper Unicode Malayalam
    else if (words.length >= 3 && hits / words.length >= 0.25) keep.push(l);  // readable English
    else if (/^(circular|no\.|ref|dated?)\b[\s.:]*[\w\s.,/-]{0,40}$/i.test(l)) keep.push(l);
  }
  const out = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const words = out.toLowerCase().match(/[a-z']{2,}/g) || [];
  const english = words.length >= 60 && words.filter((w) => COMMON.has(w)).length / words.length >= 0.2;
  if (english || ml > 400) return { text: out.slice(0, 30000), status: "ok" };
  return { text: "", status: "garbled" };
}

async function get(url: string, timeoutMs = 25000): Promise<Response> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/* ---------------- lectionary ---------------- */
function parseLectionary(html: string) {
  const heads = [...html.matchAll(/Lectionary for\s+([A-Za-z]+)\s+(\d{4})/g)].map((m) => ({ at: m.index!, month: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), year: +m[2] }));
  const starts = [...html.matchAll(/<div class="lectionary-entry">/g)].map((m) => m.index!);
  const pick = (block: string, cls: string) => { const m = block.match(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)<\\/(?:div|span)>`)); return m ? decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : ""; };
  const rows: Record<string, string | null>[] = [];
  starts.forEach((s, i) => {
    const block = html.slice(s, starts[i + 1] ?? s + 20000);
    const head = [...heads].reverse().find((h) => h.at < s);
    if (!head) return;
    const dd = parseInt(pick(block, "lectionary-date-day"), 10);
    const mon = MONTHS.indexOf(pick(block, "lectionary-date-month").slice(0, 3).toLowerCase());
    if (!dd || mon < 0) return;
    let year = head.year;
    if (head.month === 11 && mon === 0) year++;
    if (head.month === 0 && mon === 11) year--;
    const sections: Record<string, string> = {};
    for (const sec of block.split('class="reading-section"').slice(1)) {
      const label = decode((sec.match(/class="reading-label"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "").replace(/<[^>]+>/g, "")).trim();
      const refs = [...sec.matchAll(/class="reading-ref"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")).trim()).filter(Boolean);
      if (label && refs.length) sections[label] = refs.join("; ");
    }
    const take = (re: RegExp) => { const k = Object.keys(sections).find((x) => re.test(x)); if (!k) return null; const v = sections[k]; delete sections[k]; return v; };
    const lessons = take(/^lesson/i), eg = take(/epistle|gospel/i), evening = take(/evening/i);
    const other = Object.entries(sections).map(([k, v]) => `${k}: ${v}`).join(" | ") || null;
    rows.push({
      day: `${year}-${String(mon + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
      title: pick(block, "lectionary-title") || null, songs: pick(block, "songs-value") || null,
      lessons, epistle_gospel: eg, evening, other, source_url: `${MT}/prayer/`,
    });
  });
  // Special occasions (weddings, funerals, ordinations…)
  const spAt = html.search(/Special Occasion/i);
  const special = spAt > 0 ? htmlToText(html.slice(spAt, spAt + 120000)).slice(0, 20000) : "";
  return { rows, special };
}

/* ---------------- circulars (Kalpanas) ---------------- */
const circDebug: string[] = [];
async function circularList(maxPages = 4) {
  circDebug.length = 0;
  const page = await (await get(`${MT}/circulars/`)).text();
  const nonce = page.match(/marthoma-circulars-widget[^>]*data-nonce="([^"]+)"/)?.[1] || page.match(/data-nonce="([^"]+)"/)?.[1];
  const out: { title: string; number: string | null; url: string; date: string | null }[] = [];
  // First page is in the HTML itself
  for (const m of page.matchAll(/<a href="([^"]+\.pdf)" class="circular-card"[\s\S]*?circular-number-value">([^<]*)<[\s\S]*?class="circular-title">([\s\S]*?)<\/h3>/g)) {
    out.push({ url: m[1], number: m[2].trim() || null, title: decode(m[3].replace(/<[^>]+>/g, "")).trim(), date: null });
  }
  if (nonce) {
    for (let p = 1; p <= maxPages; p++) {
      const body = new URLSearchParams({ action: "marthoma_filter_circulars", nonce, search: "", year: "", thirumeni: "", organization: "", type: "", page: String(p), per_page: "50" });
      const r = await fetch(`${MT}/wp-admin/admin-ajax.php`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", "Referer": `${MT}/circulars/` }, body });
      const raw = await r.text();
      // deno-lint-ignore no-explicit-any
      let j: any = null; try { j = JSON.parse(raw); } catch { /* not JSON */ }
      const list = j?.data?.circulars || [];
      if (!list.length) circDebug.push(`ajax page ${p}: HTTP ${r.status} ${raw.slice(0, 160)}`);
      for (const c of list) {
        const url = c.pdf_url || c.url;
        if (url) out.push({ url, number: c.number ? String(c.number) : null, title: decode(String(c.title || "").replace(/<[^>]+>/g, "")).trim(), date: c.date || null });
      }
      if (!list.length || p >= (j?.data?.total_pages || 1)) break;
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}
const uploadDate = (url: string) => { const m = url.match(/\/uploads\/(\d{4})\/(\d{2})\//); return m ? `${m[1]}-${m[2]}-01` : null; };

async function pdfText(url: string): Promise<{ text: string; status: string }> {
  const r = await get(url, 40000);
  if (!r.ok) return { text: "", status: "failed" };
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 15 * 1048576) return { text: "", status: "skipped" };
  const pdf = await getDocumentProxy(buf);
  const pages: string[] = [];
  try {
    for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      // deno-lint-ignore no-explicit-any
      const items = (tc.items as any[]).filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: (it.width as number) || 0, h: Math.abs(it.transform[3] as number) || 10 }));
      page.cleanup();
      // group into lines by y (one sweep after sorting), then read each line left to right
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: (typeof items)[] = [];
      let cur: typeof items = [], curY = Infinity, curH = 10;
      for (const it of items) {
        if (cur.length && Math.abs(curY - it.y) <= Math.max(2, Math.min(curH, it.h) * 0.45)) cur.push(it);
        else { if (cur.length) lines.push(cur); cur = [it]; curY = it.y; curH = it.h; }
      }
      if (cur.length) lines.push(cur);
      pages.push(lines.map((parts) => {
        parts.sort((a, b) => a.x - b.x);
        let out = "", end = -1e9;
        for (const p of parts) {
          let str = p.s;
          if (out && p.x + p.w <= end + Math.max(0.6, p.h * 0.1)) continue;      // fake-bold overprint: same text drawn again on top
          if (out && p.x < end - 0.5 && p.w > 0) {                                  // partial overlap: drop the repeated characters
            const per = p.w / Math.max(1, str.length), n = Math.min(str.length, Math.round((end - p.x) / per));
            if (n > 0 && out.endsWith(str.slice(0, n))) str = str.slice(n);
          }
          const gap = p.x - end;
          out += (out && gap > p.h * 0.15 ? (gap > p.h * 3 ? "   " : " ") : "") + str;
          end = Math.max(end, p.x + p.w);
        }
        return out.replace(/\s+/g, (m) => (m.length >= 3 ? "   " : " ")).trim();
      }).join("\n"));
    }
  } finally {
    await pdf.destroy();
  }
  const { text, status } = cleanText(pages.join("\n\n"));
  return { text, status };
}

/* ---------------- run ---------------- */
async function setStatus(sb: SupabaseClient, patch: Record<string, unknown>) {
  const { data } = await sb.from("ref_status").select("value").eq("key", "marthoma").maybeSingle();
  await sb.from("ref_status").upsert({ key: "marthoma", value: { ...(data?.value || {}), ...patch }, updated_at: new Date().toISOString() });
}

async function readPdfs(sb: SupabaseClient, max: number, started: number) {
  const now = () => new Date().toISOString();
  // A PDF that crashed a previous run stays "reading" — give up on it rather than retrying forever.
  await sb.from("ref_docs").update({ text_status: "failed" }).eq("kind", "circular").eq("text_status", "reading").lt("fetched_at", new Date(Date.now() - 20 * 60e3).toISOString());
  const { data: pending } = await sb.from("ref_docs").select("id, url").eq("kind", "circular").eq("text_status", "pending")
    .order("published_on", { ascending: false, nullsFirst: false }).order("number", { ascending: false }).limit(max);
  let done = 0;
  for (const p of pending || []) {
    if (Date.now() - started > 100000) break;
    await sb.from("ref_docs").update({ text_status: "reading", fetched_at: now() }).eq("id", p.id);
    try {
      const { text, status } = await pdfText(p.url);
      await sb.from("ref_docs").update({ content: text || null, text_status: status, fetched_at: now() }).eq("id", p.id);
    } catch (_e) {
      await sb.from("ref_docs").update({ text_status: "failed", fetched_at: now() }).eq("id", p.id);
    }
    done++;
  }
  return done;
}

async function refresh(sb: SupabaseClient, force: boolean, mode = "all") {
  const started = Date.now();
  const log: string[] = [];
  if (mode === "pdfs") {
    const n = await readPdfs(sb, 3, started);
    return n ? [`circular PDFs read: ${n}`] : [];
  }
  const { data: st } = await sb.from("ref_status").select("value").eq("key", "marthoma").maybeSingle();
  const s = st?.value || {};
  const { data: setRow } = await sb.from("portal_settings").select("value").eq("key", "mitra_refs").maybeSingle();
  const cfg = { marthoma: true, urls: [] as string[], ...(setRow?.value || {}) };
  const stale = (k: string, hours: number) => force || !s[k] || Date.now() - new Date(s[k]).getTime() > hours * 3600e3;
  const now = () => new Date().toISOString();

  if (cfg.marthoma) {
    // Lectionary
    if (stale("lectionary_at", 20)) {
      try {
        const html = await (await get(`${MT}/prayer/`, 40000)).text();
        const { rows, special } = parseLectionary(html);
        if (rows.length) {
          for (let i = 0; i < rows.length; i += 200) {
            const { error } = await sb.from("ref_lectionary").upsert(rows.slice(i, i + 200).map((r) => ({ ...r, fetched_at: now() })));
            if (error) throw error;
          }
        }
        if (special) await sb.from("ref_docs").upsert({ source: "marthoma.in", kind: "special_lectionary", url: `${MT}/prayer/#special-occasions`, title: "Lectionary for special occasions (weddings, funerals, ordinations and more)", content: special, text_status: "ok", fetched_at: now() }, { onConflict: "url" });
        await setStatus(sb, { lectionary_at: now(), lectionary_entries: rows.length });
        log.push(`lectionary: ${rows.length} entries`);
      } catch (e) { log.push(`lectionary failed: ${(e as Error).message}`); await setStatus(sb, { last_error: `lectionary: ${(e as Error).message}` }); }
    }
    // Key pages
    if (stale("pages_at", 20)) {
      const pages: { url: string; title: string; text: string }[] = [];
      for (const p of MT_PAGES) {
        if (Date.now() - started > 60000) break;
        try { const html = await (await get(MT + p)).text(); pages.push({ url: MT + p, title: titleOf(html) || p, text: htmlToText(html) }); }
        catch (_e) { log.push(`page ${p} failed`); }
      }
      // Remove boilerplate lines (menus, footers) that repeat across most pages
      const counts = new Map<string, number>();
      pages.forEach((pg) => new Set(pg.text.split("\n")).forEach((l) => counts.set(l, (counts.get(l) || 0) + 1)));
      const limit = Math.max(3, Math.floor(pages.length * 0.4));
      for (const pg of pages) {
        const body = pg.text.split("\n").filter((l) => (counts.get(l) || 0) < limit).join("\n").slice(0, 25000);
        await sb.from("ref_docs").upsert({ source: "marthoma.in", kind: "page", url: pg.url, title: pg.title, content: body, text_status: body.length > 80 ? "ok" : "empty", fetched_at: now() }, { onConflict: "url" });
      }
      await setStatus(sb, { pages_at: now(), pages: pages.length });
      log.push(`pages: ${pages.length}`);
    }
    // News (via the site's API)
    if (stale("news_at", 6)) {
      try {
        const r = await get(`${MT}/wp-json/wp/v2/marthoma_news?per_page=20&_fields=title,date,link,content`);
        const items = (await r.json()) as { title: { rendered: string }; date: string; link: string; content: { rendered: string } }[];
        for (const n of items) {
          const pdfs = [...(n.content?.rendered || "").matchAll(/href="([^"]+\.pdf)"/g)].map((m) => m[1]);
          const body = (htmlToText(n.content?.rendered || "") + (pdfs.length ? `\nAttached document: ${pdfs[0]}` : "")).slice(0, 8000);
          await sb.from("ref_docs").upsert({ source: "marthoma.in", kind: "news", url: n.link, title: decode(n.title.rendered), published_on: n.date.slice(0, 10), content: body, text_status: "ok", fetched_at: now() }, { onConflict: "url" });
        }
        await setStatus(sb, { news_at: now(), news: items.length });
        log.push(`news: ${items.length}`);
      } catch (e) { log.push(`news failed: ${(e as Error).message}`); }
    }
    // Kalpanas / circulars list
    if (stale("circulars_at", 3)) {
      try {
        const list = await circularList(4);
        const { data: existing } = await sb.from("ref_docs").select("url").eq("kind", "circular");
        const have = new Set((existing || []).map((x) => x.url));
        const fresh = list.filter((c) => !have.has(c.url)).map((c) => ({
          source: "marthoma.in", kind: "circular", url: c.url, title: c.title, number: c.number,
          published_on: (c.date && /^\d{4}-\d{2}-\d{2}/.test(c.date) ? c.date.slice(0, 10) : null) || uploadDate(c.url), text_status: /\.pdf($|\?)/i.test(c.url) ? "pending" : "skipped",
        }));
        for (let i = 0; i < fresh.length; i += 100) { const { error } = await sb.from("ref_docs").insert(fresh.slice(i, i + 100)); if (error) throw error; }
        // keep titles/numbers up to date for ones we already have
        for (const c of list.filter((c) => have.has(c.url)).slice(0, 60)) await sb.from("ref_docs").update({ title: c.title, number: c.number }).eq("url", c.url);
        await setStatus(sb, { circulars_at: now(), circulars_listed: list.length });
        log.push(`circulars listed: ${list.length} (${fresh.length} new)`, ...circDebug);
      } catch (e) { log.push(`circulars failed: ${(e as Error).message}`); await setStatus(sb, { last_error: `circulars: ${(e as Error).message}` }); }
    }
  }

  // Extra pages added by admins
  if (cfg.urls?.length && stale("extra_at", 20)) {
    for (const u of cfg.urls.slice(0, 25)) {
      if (Date.now() - started > 90000) break;
      try {
        const html = await (await get(u)).text();
        const body = htmlToText(html).slice(0, 25000);
        await sb.from("ref_docs").upsert({ source: new URL(u).hostname, kind: "page", url: u, title: titleOf(html) || u, content: body, text_status: body.length > 80 ? "ok" : "empty", fetched_at: now() }, { onConflict: "url" });
      } catch (_e) { log.push(`extra ${u} failed`); }
    }
    await setStatus(sb, { extra_at: now() });
  }

  // Read the text of Kalpana PDFs, newest first. PDF parsing is heavy, so only a few per run
  // (a separate job runs every 10 minutes just for this).
  const pdfDone = await readPdfs(sb, mode === "pdfs" ? 3 : 2, started);
  if (pdfDone) log.push(`circular PDFs read: ${pdfDone}`);
  await setStatus(sb, { last_run: now(), last_log: log.slice(0, 20) });
  return log;
}

async function status(sb: SupabaseClient) {
  const [{ data: st }, lect, circ, pages, news] = await Promise.all([
    sb.from("ref_status").select("value").eq("key", "marthoma").maybeSingle(),
    sb.from("ref_lectionary").select("day").order("day"),
    sb.from("ref_docs").select("text_status").eq("kind", "circular"),
    sb.from("ref_docs").select("id", { count: "exact", head: true }).eq("kind", "page"),
    sb.from("ref_docs").select("id", { count: "exact", head: true }).eq("kind", "news"),
  ]);
  const days = (lect.data || []).map((x) => x.day);
  const cs = (circ.data || []).reduce((m: Record<string, number>, x) => ((m[x.text_status] = (m[x.text_status] || 0) + 1), m), {});
  return { ...(st?.value || {}), lectionary: { entries: days.length, from: days[0] || null, to: days[days.length - 1] || null }, circulars: cs, pages: pages.count || 0, news: news.count || 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    // Who is calling? The hourly job (secret key) or a signed-in officer.
    const cronKey = req.headers.get("x-cron-key");
    let allowed = false;
    if (cronKey) {
      const { data } = await sb.from("app_secrets").select("value").eq("key", "cron").maybeSingle();
      allowed = !!data && data.value === cronKey;
    } else {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await sb.auth.getUser(token);
      if (user) {
        const { data: m } = await sb.from("members").select("role").eq("auth_user_id", user.id).maybeSingle();
        allowed = !!m && ["officer", "admin"].includes(m.role);
      }
    }
    if (!allowed) return json({ error: "Not allowed." }, 403);

    const body = await req.json().catch(() => ({}));
    if (body.action === "status") return json({ ok: true, status: await status(sb) });
    const log = await refresh(sb, !!body.force, body.mode === "pdfs" ? "pdfs" : "all");
    if (body.mode === "pdfs") return json({ ok: true, log });
    return json({ ok: true, log, status: await status(sb) });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
