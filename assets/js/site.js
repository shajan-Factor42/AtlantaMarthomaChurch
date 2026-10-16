// Mar Thoma Church, Atlanta — public site behavior

// Turn a Zeffy form link (as copied from Zeffy, e.g. https://www.zeffy.com/en-US/donation-form/abc)
// into its embeddable version (https://www.zeffy.com/embed/donation-form/abc). Embed links pass through.
window.MTCA_ZEFFY_EMBED = function (link) {
  try {
    const u = new URL(String(link).trim());
    if (!/(^|\.)zeffy\.com$/.test(u.hostname)) return u.href;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed') return u.href;
    if (/^[a-z]{2}(-[A-Za-z]{2})?$/.test(parts[0] || '')) parts.shift();   // drop the language, e.g. en-US
    return `https://www.zeffy.com/embed/${parts.join('/')}${u.search}`;
  } catch (e) { return link; }
};

(function () {
  // Mobile nav
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // "Show password" toggles on sign-in forms
  document.addEventListener('change', (e) => {
    if (!e.target.matches('[data-show-pw]')) return;
    e.target.closest('form').querySelectorAll('input[name=password], input[name=confirm]').forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; });
  });

  // Sunday services: the regular services (default 8:00 AM English, 10:00 AM Malayalam) with any
  // per-Sunday changes the admin has made (Admin → Worship), loaded from the database.
  const W = { services: [{ time: '08:00', language: 'English' }, { time: '10:00', language: 'Malayalam' }], changes: {}, lect: {} };
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const nextSunday = (from) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const add = (7 - d.getDay()) % 7 || (from.getHours() >= 13 ? 7 : 0); // after Sunday services, look ahead a week
    d.setDate(d.getDate() + add);
    return d;
  };
  const fmtTime = (t) => { const [h, m] = String(t || '10:00').split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
  const fmt = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const english = (title) => (title || '').split(/;|\s[–-]\s/).map((x) => x.trim()).filter((x) => x && !/[ഀ-ൿ]/.test(x)).join(' · ');
  const norm = (list) => list.map((x) => ({ time: String(x.time || '10:00').slice(0, 5), language: x.language || 'English' })).sort((a, b) => a.time.localeCompare(b.time));
  const info = (d) => {
    const c = W.changes[ymd(d)] || null;
    const off = !!(c && (c.no_service || c.language === 'No service'));
    const own = c && Array.isArray(c.services) && c.services.length ? norm(c.services) : null;
    return { off, services: off ? [] : own || norm(W.services), custom: !!own, note: (c && c.note) || '', celebrant: (c && c.celebrant) || '', changed: !!c };
  };
  const svcShort = (list) => list.map((x) => `${fmtTime(x.time)} ${x.language}`).join(' · ');

  const sun = nextSunday(new Date());
  const up = document.querySelector('[data-upcoming-sundays]');
  function renderSundays() {
    const t = info(sun), reg = norm(W.services);
    // Top banner: "Sunday Worship · 8:00 AM English · 10:00 AM Malayalam"
    document.querySelectorAll('[data-sunday-services]').forEach((el) => { el.textContent = t.off ? 'No service this Sunday' : svcShort(t.services); });
    document.querySelectorAll('[data-sunday-date]').forEach((el) => { el.textContent = fmt(sun); });
    document.querySelectorAll('[data-sunday-list]').forEach((el) => {
      el.innerHTML = t.off ? '<li><span>No service this Sunday</span></li>' : t.services.map((x) => `<li><span>${esc(fmtTime(x.time))}</span><strong>${esc(x.language)}</strong></li>`).join('');
    });
    document.querySelectorAll('[data-sunday-note]').forEach((el) => { el.textContent = [t.note, t.celebrant].filter(Boolean).join(' · '); el.hidden = !el.textContent; });
    document.querySelectorAll('[data-worship-times]').forEach((el) => { el.textContent = svcShort(reg); });
    document.querySelectorAll('[data-worship-sentence]').forEach((el) => {
      el.textContent = reg.length === 1 ? `one service at ${fmtTime(reg[0].time)} in ${reg[0].language}` :
        `${reg.length === 2 ? 'two' : reg.length} services: ` + reg.map((x, i) => `${i === reg.length - 1 ? 'and ' : ''}${x.language} at ${fmtTime(x.time)}`).join(reg.length > 2 ? ', ' : ' ');
    });
    if (up) {
      const rich = up.hasAttribute('data-with-readings');
      let html = '';
      const d = new Date(sun);
      for (let i = 0; i < (rich ? 6 : 5); i++) {
        const x = info(d), lect = W.lect[ymd(d)];
        const extra = [x.note, x.celebrant].filter(Boolean).join(' · ');
        html += `<li class="sun${x.custom || x.off ? ' sun--changed' : ''}${x.off ? ' sun--off' : ''}">
          <div class="sun__row"><span>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <strong>${x.off ? 'No service' : x.services.map((s) => `<span class="sun__svc">${esc(fmtTime(s.time))} ${esc(s.language)}</span>`).join('')}</strong></div>
          ${extra ? `<p class="sun__note">${esc(extra)}</p>` : ''}
          ${rich && lect ? `<details class="sun__readings"><summary>${esc(english(lect.title) || 'Readings')}</summary>
            <dl>${lect.lessons ? `<dt>Lessons</dt><dd>${esc(lect.lessons)}</dd>` : ''}${lect.epistle_gospel ? `<dt>Epistle / Gospel</dt><dd>${esc(lect.epistle_gospel)}</dd>` : ''}${lect.evening ? `<dt>Evening</dt><dd>${esc(lect.evening)}</dd>` : ''}${lect.songs ? `<dt>Song</dt><dd>${esc(lect.songs)}</dd>` : ''}</dl></details>` : ''}
        </li>`;
        d.setDate(d.getDate() + 7);
      }
      up.innerHTML = html;
    }
  }
  renderSundays();

  const CFG = window.MTCA_CONFIG || {};
  const apply = (setting, changes, lect) => {
    if (setting && Array.isArray(setting.services) && setting.services.length) W.services = setting.services;
    W.changes = Object.fromEntries((changes || []).map((c) => [c.day, c]));
    W.lect = Object.fromEntries((lect || []).map((l) => [l.day, l]));
    renderSundays();
  };
  if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !window.__MTCA_FAKE_SB) {
    const last = new Date(sun); last.setDate(last.getDate() + 42);
    const range = `day=gte.${ymd(sun)}&day=lte.${ymd(last)}`;
    const get = (path) => fetch(`${CFG.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: CFG.SUPABASE_ANON_KEY } }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    Promise.all([
      get('portal_settings?key=eq.worship&select=value'),
      get(`worship_services?${range}&select=day,language,services,no_service,note,celebrant`),
      up && up.hasAttribute('data-with-readings') ? get(`ref_lectionary?${range}&select=day,title,lessons,epistle_gospel,evening,songs`) : []
    ]).then(([setting, changes, lect]) => apply(setting[0] && setting[0].value, changes, lect));
  } else if (window.__MTCA_FAKE_SB && window.__FAKE_SEED) { // preview / tests
    const db = window.__FAKE_SEED.db || {};
    const sv = (db.portal_settings || []).find((r) => r.key === 'worship');
    apply(sv && sv.value, db.worship_services, db.ref_lectionary);
  }

  // Lightbox
  const box = document.getElementById('lightbox');
  if (!box) return;
  const img = box.querySelector('img');
  let items = [], idx = 0;
  const show = (i) => { idx = (i + items.length) % items.length; img.src = items[idx].href; };
  const close = () => { box.hidden = true; img.src = ''; document.body.style.overflow = ''; };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-lightbox]');
    if (!a) return;
    e.preventDefault();
    items = [...a.closest('[data-lightbox-group]').querySelectorAll('[data-lightbox]')];
    show(items.indexOf(a));
    box.hidden = false;
    document.body.style.overflow = 'hidden';
  });
  box.querySelector('.lightbox__close').onclick = close;
  box.querySelector('.lightbox__prev').onclick = () => show(idx - 1);
  box.querySelector('.lightbox__next').onclick = () => show(idx + 1);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });
})();
