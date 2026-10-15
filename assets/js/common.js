// Shared helpers for the member portal, admin area and public pages.

export const CFG = window.MTCA_CONFIG || {};
export const TZ = 'America/New_York';
let clientPromise = null;

export const configured = () => !!(window.__MTCA_FAKE_SB || (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY));

/** Supabase client, loaded on demand. Resolves to null when the site isn't connected. */
export function getClient() {
  if (window.__MTCA_FAKE_SB) return Promise.resolve(window.__MTCA_FAKE_SB);
  if (!configured()) return Promise.resolve(null);
  clientPromise ||= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(({ createClient }) => createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY));
  return clientPromise;
}

/** Throw on Supabase errors, return data otherwise. */
export const ok = ({ data, error }) => { if (error) throw error; return data; };

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const val = (v) => (v === null || v === undefined || v === '') ? '<span class="muted">—</span>' : esc(v);
export const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/** Format a YYYY-MM-DD date without timezone drift. */
export const date = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export const dateTime = (iso, allDay) => {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return allDay ? day : `${day} · ${d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })}`;
};
export const timeOnly = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

/** YYYY-MM-DD of an instant, in church time. */
export const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

/** Convert a datetime-local value ("2026-10-18T10:00") to ISO, interpreting it as church time. */
export function localToIso(v) {
  if (!v) return null;
  const [d, t = '00:00'] = v.split('T');
  const guess = new Date(`${d}T${t}:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  const offset = shown.getTime() - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(guess.getTime() - offset).toISOString();
}
/** ISO → value for a datetime-local input, in church time. */
export function isoToLocal(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function friendly(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (/invalid login/i.test(m)) return 'That email and password don’t match. Try again, or use “Email me a sign-in link”.';
  if (/signups not allowed|user not found/i.test(m)) return 'We couldn’t find that email. Please contact the church secretary to be invited.';
  if (/rate limit/i.test(m)) return 'Too many attempts — please wait a minute and try again.';
  if (/row-level security|permission denied/i.test(m)) return 'You don’t have permission to do that.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Couldn’t reach the server. Check your connection and try again.';
  return m;
}

export function msg(form, text, isError) {
  const el = $('.form__msg', form);
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}
export const busy = (form, on) => $$('button', form).forEach((b) => (b.disabled = on));

let toastTimer;
export function toast(text, isError) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = text;
  t.classList.toggle('is-error', !!isError);
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3500);
}

/**
 * Modal form. `onSave(values, form)` may throw to show an error; returning normally closes it.
 * Checkbox values arrive as booleans.
 */
export function dialog(title, bodyHtml, onSave, { saveLabel = 'Save', danger = false, wide = false } = {}) {
  const d = document.createElement('dialog');
  d.className = 'dlg' + (wide ? ' dlg--wide' : '');
  d.innerHTML = `<form method="dialog" class="form form--flat"><h2>${title}</h2>${bodyHtml}
    <div class="dlg__actions"><button value="cancel" class="btn btn--outline btn--small" formnovalidate>Cancel</button>${onSave ? `<button value="save" class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--small">${saveLabel}</button>` : ''}</div>
    <p class="form__msg" role="status"></p></form>`;
  document.body.appendChild(d);
  const form = $('form', d);
  form.addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    if (!onSave) return d.close();
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    $$('input[type=checkbox][name]', form).forEach((c) => (values[c.name] = c.checked));
    busy(form, true);
    try { await onSave(values, form); d.close(); }
    catch (err) { msg(form, friendly(err), true); busy(form, false); }
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
export const confirmDialog = (title, text, onYes, label = 'Delete') =>
  dialog(title, `<p>${text}</p>`, onYes, { saveLabel: label, danger: true });

export async function getSettings(sb) {
  const defaults = {
    member_tabs: { overview: true, profile: true, family: true, giving: true, organizations: true, directory: true, documents: true, photos: true, account: true },
    photo_uploads: { enabled: true, max_mb: 10, note: '' },
    home: { announcements: true, announcement_count: 3, events: true, event_count: 4 },
    chat: { enabled: true, greeting: '', hourly_limit: 30, daily_site_limit: 1500 }
  };
  try {
    const rows = ok(await sb.from('portal_settings').select('key, value'));
    rows.forEach((r) => (defaults[r.key] = { ...(defaults[r.key] || {}), ...r.value }));
  } catch (e) { /* fall back to defaults */ }
  return defaults;
}

export function csv(rows) {
  const flat = rows.map((r) => {
    const o = { ...r };
    Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { Object.entries(o[k]).forEach(([kk, vv]) => (o[`${k}_${kk}`] = vv)); delete o[k]; } });
    return o;
  });
  const cols = [...new Set(flat.flatMap(Object.keys))];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.map(q).join(','), ...flat.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
}
export function download(name, text, type = 'text/csv') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Calendar file for one event. */
export function icsFor(ev) {
  const fmt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dayOnly = (iso) => dayKey(iso).replace(/-/g, '');
  const nextDay = (iso) => { const d = new Date(dayKey(iso) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
  const clean = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const end = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 3600e3).toISOString();
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mar Thoma Church Atlanta//Events//EN', 'BEGIN:VEVENT',
    `UID:${ev.id}@mtcatlanta.org`, `DTSTAMP:${fmt(new Date().toISOString())}`,
    ev.all_day ? `DTSTART;VALUE=DATE:${dayOnly(ev.starts_at)}` : `DTSTART:${fmt(ev.starts_at)}`,
    ev.all_day ? `DTEND;VALUE=DATE:${nextDay(ev.ends_at || ev.starts_at)}` : `DTEND:${fmt(end)}`,
    `SUMMARY:${clean(ev.title)}`, ev.location ? `LOCATION:${clean(ev.location)}` : '', ev.description ? `DESCRIPTION:${clean(ev.description)}` : '',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}

/** Shrink big photos before upload (keeps them sharp but much smaller). */
export async function prepareImage(file, maxSide = 2400, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 2.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}

/** Site root (works on github.io/AtlantaMarthomaChurch and on mtcatlanta.org). */
const SITE_ROOT = new URL('../../', import.meta.url);
/** Flyer / cover images: full URLs (uploaded to storage) or paths inside the site (e.g. assets/flyers/x.jpg). */
export const mediaUrl = (u) => !u ? '' : /^https?:\/\//i.test(u) ? u : new URL(String(u).replace(/^\/+/, ''), SITE_ROOT).href;

/** Escape text, then turn bare web addresses into links. */
export const linkify = (text) => esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>`);
