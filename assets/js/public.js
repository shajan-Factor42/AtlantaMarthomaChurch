// Public pages: home announcements & events, Events calendar, member photo album.
// Each block only loads data when its element is on the page.
import { getClient, configured, getSettings, ok, $, $$, esc, date, dateTime, timeOnly, dayKey, todayIso, TZ, download, icsFor, mediaUrl, linkify } from './common.js';

const homeAnn = $('[data-home-announcements]');
const homeEvents = $('[data-home-events]');
const calendar = $('[data-events-calendar]');
const memberGallery = $('[data-member-gallery]');

if ((homeAnn || homeEvents || calendar || memberGallery) && configured()) {
  getClient().then(async (sb) => {
    if (!sb) return;
    try { signedIn = !!(await sb.auth.getSession()).data.session; } catch (e) { signedIn = false; }
    if (homeAnn || homeEvents) await home(sb).catch((e) => console.warn(e));
    if (calendar) await events(sb).catch((e) => { console.warn(e); $('[data-cal-status]', calendar).textContent = 'The calendar couldn’t load. Please try again later.'; });
    if (memberGallery) await gallery(sb).catch((e) => console.warn(e));
  }).catch((e) => { console.warn('Live content unavailable', e); if (calendar) $('[data-cal-status]', calendar).textContent = 'The calendar couldn’t load. Please try again later.'; });
} else if (calendar) {
  $('[data-cal-status]', calendar).textContent = 'The calendar isn’t available right now.';
}

let signedIn = false;
/** Members-only events are also blocked by the database for visitors; this keeps the query honest. */
const visibleTo = (q) => (signedIn ? q : q.eq('members_only', false));

const monthShort = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short' });
const dayNum = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, day: 'numeric' });

function eventDialog(e) {
  const d = document.createElement('dialog');
  d.className = 'dlg';
  d.innerHTML = `<div class="event-detail${e.flyer_url ? ' event-detail--flyer' : ''}">
    ${e.flyer_url ? `<a class="event-detail__flyer" href="${esc(mediaUrl(e.flyer_url))}" target="_blank" rel="noopener" title="Open the full flyer"><img src="${esc(mediaUrl(e.flyer_url))}" alt="Flyer for ${esc(e.title)}"></a>` : ''}
    <div class="event-detail__body">
    <p class="eyebrow">${esc(e.category)}${e.members_only ? ' · Members only' : ''}</p>
    <h2>${esc(e.title)}</h2>
    <p class="event-when">${esc(dateTime(e.starts_at, e.all_day))}${e.ends_at && !e.all_day ? ' – ' + esc(timeOnly(e.ends_at)) : ''}</p>
    ${e.location ? `<p><strong>Where:</strong> ${esc(e.location)}</p>` : ''}
    ${e.description ? `<p class="pre">${linkify(e.description)}</p>` : ''}
    <div class="dlg__actions">${e.link_url ? `<a class="btn btn--gold btn--small" href="${esc(e.link_url)}" target="_blank" rel="noopener">Register / details</a>` : ''}<button class="btn btn--outline btn--small" data-ics>Add to my calendar</button><button class="btn btn--primary btn--small" data-close>Close</button></div></div></div>`;
  document.body.appendChild(d);
  $('[data-close]', d).onclick = () => d.close();
  $('[data-ics]', d).onclick = () => download(`${e.title.replace(/[^\w]+/g, '-')}.ics`, icsFor(e), 'text/calendar');
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

const eventItem = (e, i) => `
  <li><button class="event-row" data-ev="${i}">
    <span class="date-badge"><b>${monthShort(e.starts_at)}</b>${dayNum(e.starts_at)}</span>
    ${e.flyer_url ? `<img class="event-row__flyer" src="${esc(mediaUrl(e.flyer_url))}" alt="" loading="lazy">` : ''}
    <span class="event-row__text"><strong>${esc(e.title)}</strong><small>${e.all_day ? 'All day' : esc(timeOnly(e.starts_at))}${e.location ? ' · ' + esc(e.location) : ''}</small></span>
  </button></li>`;

/* ---------------- Home page ---------------- */
async function home(sb) {
  const s = await getSettings(sb);
  const section = $('[data-home-dynamic]');
  let shown = false;

  if (homeAnn && s.home.announcements) {
    const anns = ok(await sb.from('member_announcements').select('id, title, body, published_on, expires_on, pinned, link_url, flyer_url, audience')
      .in('audience', ['public', 'both']).lte('published_on', todayIso())
      .order('pinned', { ascending: false }).order('published_on', { ascending: false }).limit(30))
      .filter((a) => !a.expires_on || a.expires_on >= todayIso()).slice(0, Number(s.home.announcement_count) || 3);
    if (anns.length) {
      homeAnn.innerHTML = anns.map((a) => `
        <article class="notice-card${a.pinned ? ' notice-card--pinned' : ''}${a.flyer_url ? ' notice-card--flyer' : ''}">
          ${a.flyer_url ? `<a class="notice-card__flyer" href="${esc(mediaUrl(a.flyer_url))}" data-lightbox title="Open the full flyer"><img src="${esc(mediaUrl(a.flyer_url))}" alt="Flyer: ${esc(a.title)}" loading="lazy"></a>` : ''}
          <p class="notice-card__date">${a.pinned ? 'Pinned · ' : ''}${date(a.published_on)}</p>
          <h3>${esc(a.title)}</h3>
          <p>${linkify(a.body)}</p>
          ${a.link_url ? `<a class="text-link" href="${esc(a.link_url)}" target="_blank" rel="noopener">More details →</a>` : ''}
        </article>`).join('');
      homeAnn.closest('[data-block]').hidden = false;
      shown = true;
    }
  }

  if (homeEvents && s.home.events) {
    const evs = ok(await visibleTo(sb.from('events').select('*').eq('published', true))
      .gte('starts_at', new Date(Date.now() - 3 * 3600e3).toISOString()).order('starts_at').limit(Number(s.home.event_count) || 4));
    if (evs.length) {
      homeEvents.innerHTML = `<ul class="event-list">${evs.map(eventItem).join('')}</ul>`;
      $$('[data-ev]', homeEvents).forEach((b) => (b.onclick = () => eventDialog(evs[+b.dataset.ev])));
      homeEvents.closest('[data-block]').hidden = false;
      shown = true;
    }
  }
  if (section && shown) section.hidden = false;
}

/** An event is past once it has ended (all-day events: at the end of that day). */
function isPast(e) {
  const end = e.ends_at ? new Date(e.ends_at) : new Date(e.starts_at);
  if (!e.ends_at) end.setTime(end.getTime() + (e.all_day ? 0 : 3 * 3600e3));
  return e.all_day && !e.ends_at ? dayKey(e.starts_at) < todayIso() : end < new Date();
}

async function pastEvents(sb) {
  const box = $('[data-past-events]');
  if (!box) return;
  const rows = ok(await visibleTo(sb.from('events').select('*').eq('published', true))
    .lt('starts_at', new Date().toISOString()).gte('starts_at', new Date(Date.now() - 400 * 864e5).toISOString())
    .order('starts_at', { ascending: false }).limit(150)).filter(isPast);
  // Weekly repeats (e.g. Pickleball) shown once, as their most recent date
  const seen = new Set();
  const past = rows.filter((e) => { const k = e.title.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!past.length) { box.innerHTML = '<p class="empty">Past events will appear here after they take place.</p>'; return; }
  const LIMIT = 12;
  const render = (all) => {
    const items = all ? past : past.slice(0, LIMIT);
    const groups = [];
    items.forEach((e, i) => {
      const mo = new Date(e.starts_at).toLocaleDateString('en-US', { timeZone: TZ, month: 'long', year: 'numeric' });
      if (!groups.length || groups[groups.length - 1][0] !== mo) groups.push([mo, []]);
      groups[groups.length - 1][1].push([e, i]);
    });
    box.innerHTML = `<div class="past-grid">${groups.map(([mo, list]) => `<div class="past-month"><h3>${esc(mo)}</h3><ul class="event-list">${list.map(([e, i]) => eventItem(e, i)).join('')}</ul></div>`).join('')}</div>
      ${!all && past.length > LIMIT ? `<p><button class="btn btn--outline btn--small" data-past-more>Show all ${past.length} past events</button></p>` : ''}`;
    $$('[data-ev]', box).forEach((b) => (b.onclick = () => eventDialog(past[+b.dataset.ev])));
    const more = $('[data-past-more]', box); if (more) more.onclick = () => render(true);
  };
  render(false);
}

/* ---------------- Events calendar ---------------- */
async function events(sb) {
  const grid = $('[data-cal-grid]', calendar);
  const label = $('[data-cal-label]', calendar);
  const list = $('[data-cal-list]', calendar);
  const status = $('[data-cal-status]', calendar);
  let y = +todayIso().slice(0, 4), m = +todayIso().slice(5, 7) - 1;
  const params = new URLSearchParams(location.search);
  if (/^\d{4}-\d{2}$/.test(params.get('month') || '')) { y = +params.get('month').slice(0, 4); m = +params.get('month').slice(5) - 1; }
  let rows = [];

  async function load() {
    const from = new Date(Date.UTC(y, m, 1) - 7 * 864e5).toISOString();
    const to = new Date(Date.UTC(y, m + 1, 1) + 7 * 864e5).toISOString();
    status.textContent = 'Loading events…';
    rows = ok(await visibleTo(sb.from('events').select('*').eq('published', true)).gte('starts_at', from).lt('starts_at', to).order('starts_at'));
    status.textContent = '';
    draw();
  }

  function draw() {
    const first = new Date(Date.UTC(y, m, 1));
    label.textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const startDow = first.getUTCDay();
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const byDay = {};
    rows.forEach((e, i) => { (byDay[dayKey(e.starts_at)] ||= []).push(i); });
    const today = todayIso();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="cal__cell cal__cell--empty" aria-hidden="true"></div>';
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const evs = byDay[key] || [];
      const sunday = (startDow + d - 1) % 7 === 0;
      cells += `<div class="cal__cell${key === today ? ' is-today' : ''}${sunday ? ' is-sunday' : ''}${evs.length ? ' has-events' : ''}">
        <span class="cal__day">${d}</span>
        ${evs.map((i) => `<button class="cal__event cat-${esc(rows[i].category.toLowerCase().replace(/\s+/g, '-'))}" data-ev="${i}" title="${esc(rows[i].title)}">${rows[i].all_day ? '' : `<span>${esc(timeOnly(rows[i].starts_at).replace(':00', '').replace(' ', '').toLowerCase())}</span> `}${esc(rows[i].title)}</button>`).join('')}
      </div>`;
    }
    grid.innerHTML = cells;
    $$('.cal__event[data-ev]', calendar).forEach((b) => { if (isPast(rows[+b.dataset.ev])) b.classList.add('is-past'); });
    $$('[data-ev]', grid).forEach((b) => (b.onclick = () => eventDialog(rows[+b.dataset.ev])));
    const url = new URL(location.href);
    url.searchParams.set('month', `${y}-${String(m + 1).padStart(2, '0')}`);
    history.replaceState(null, '', url);
  }

  // Side list: the next upcoming events (past ones move to "Past events" below)
  (async () => {
    const up = ok(await visibleTo(sb.from('events').select('*').eq('published', true))
      .gte('starts_at', new Date(Date.now() - 24 * 3600e3).toISOString()).order('starts_at').limit(12)).filter((e) => !isPast(e)).slice(0, 8);
    list.innerHTML = up.length ? `<ul class="event-list">${up.map((e, i) => eventItem(e, i)).join('')}</ul>` : '<p class="empty">No upcoming events posted yet.</p>';
    $$('[data-ev]', list).forEach((b) => (b.onclick = () => eventDialog(up[+b.dataset.ev])));
  })().catch((e) => console.warn(e));
  pastEvents(sb).catch((e) => { console.warn(e); const box = $('[data-past-events]'); if (box) box.innerHTML = ''; });

  $('[data-cal-prev]', calendar).onclick = () => { m--; if (m < 0) { m = 11; y--; } load(); };
  $('[data-cal-next]', calendar).onclick = () => { m++; if (m > 11) { m = 0; y++; } load(); };
  $('[data-cal-today]', calendar).onclick = () => { y = +todayIso().slice(0, 4); m = +todayIso().slice(5, 7) - 1; load(); };
  await load();
}

/* ---------------- Gallery: approved member photos ---------------- */
async function gallery(sb) {
  const rows = ok(await sb.from('photo_submissions').select('id, storage_path, caption, event_name, created_at')
    .eq('status', 'approved').eq('show_in_gallery', true).order('created_at', { ascending: false }).limit(200));
  if (!rows.length) return;
  const urls = ok(await sb.storage.from('member-photos').createSignedUrls(rows.map((r) => r.storage_path), 6 * 3600));
  const byPath = Object.fromEntries(urls.filter((u) => u.signedUrl).map((u) => [u.path, u.signedUrl]));
  const shown = rows.filter((r) => byPath[r.storage_path]);
  if (!shown.length) return;
  $('[data-member-photos]', memberGallery).innerHTML = shown.map((r) => `
    <a href="${esc(byPath[r.storage_path])}" data-lightbox title="${esc([r.event_name, r.caption].filter(Boolean).join(' — '))}">
      <img src="${esc(byPath[r.storage_path])}" alt="${esc(r.caption || r.event_name || 'Photo shared by a parish member')}" loading="lazy">
    </a>`).join('');
  memberGallery.hidden = false;
}
