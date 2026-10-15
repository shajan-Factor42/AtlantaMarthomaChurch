// Mar Thoma Church, Atlanta — public site behavior
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

  // Sunday services: regular pattern (1st & 3rd Malayalam, 2nd & 4th English) with any
  // per-Sunday changes the admin has made (Admin → Worship), loaded from the database.
  const W = {
    pattern: { time: '10:00', schedule: { 1: 'Malayalam', 2: 'English', 3: 'Malayalam', 4: 'English', 5: 'Special' }, fifth_note: 'See announcements' },
    changes: {}, lect: {}
  };
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const nextSunday = (from) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const add = (7 - d.getDay()) % 7 || (from.getHours() >= 12 ? 7 : 0); // after noon on Sunday, look ahead a week
    d.setDate(d.getDate() + add);
    return d;
  };
  const fmtTime = (t) => { const [h, m] = String(t || '10:00').split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
  const fmt = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const english = (title) => (title || '').split(/;|\s[–-]\s/).map((x) => x.trim()).filter((x) => x && !/[ഀ-ൿ]/.test(x)).join(' · ');
  const info = (d) => {
    const nth = Math.ceil(d.getDate() / 7), c = W.changes[ymd(d)] || {};
    const lang = c.language || W.pattern.schedule[nth] || 'Special';
    return { nth, lang, time: c.time || W.pattern.time, note: c.note || (lang === 'Special' ? W.pattern.fifth_note || '' : ''), celebrant: c.celebrant || '', changed: !!W.changes[ymd(d)] };
  };
  const langLabel = (i) => (i.lang === 'Special' ? 'Special service' : i.lang === 'No service' ? 'No service' : i.lang === 'Combined' ? 'Combined service' : i.lang);

  const sun = nextSunday(new Date());
  const up = document.querySelector('[data-upcoming-sundays]');
  function renderSundays() {
    const t = info(sun);
    document.querySelectorAll('[data-sunday-language]').forEach((el) => { el.textContent = t.lang === 'Special' ? 'Special' : t.lang; });
    document.querySelectorAll('[data-sunday-date]').forEach((el) => { el.textContent = fmt(sun); });
    document.querySelectorAll('[data-sunday-time]').forEach((el) => { el.textContent = t.lang === 'No service' ? 'No service' : fmtTime(t.time); });
    document.querySelectorAll('[data-sunday-note]').forEach((el) => { el.textContent = [t.note, t.celebrant].filter(Boolean).join(' · '); el.hidden = !el.textContent; });
    document.querySelectorAll('[data-worship-time]').forEach((el) => { el.textContent = fmtTime(W.pattern.time); });
    const s = W.pattern.schedule;
    const groups = {};
    [1, 2, 3, 4].forEach((n) => { (groups[s[n]] ||= []).push(['1st', '2nd', '3rd', '4th'][n - 1]); });
    const sentence = Object.entries(groups).map(([lang, ns]) => `${lang === 'Special' ? 'a special service' : lang} on the ${ns.join(' and ')} Sunday${ns.length > 1 ? 's' : ''}`).join(', and ');
    document.querySelectorAll('[data-worship-pattern]').forEach((el) => { el.textContent = sentence; });
    document.querySelectorAll('[data-worship-schedule]').forEach((el) => {
      el.innerHTML = Object.entries(groups).map(([lang, ns]) => `<li><span>${ns.join(' & ')} Sundays</span><strong>${esc(lang)}</strong></li>`).join('');
    });
    if (up) {
      const rich = up.hasAttribute('data-with-readings');
      let html = '';
      const d = new Date(sun);
      for (let i = 0; i < (rich ? 6 : 5); i++) {
        const x = info(d), lect = W.lect[ymd(d)];
        const extra = [x.lang !== 'No service' && x.time !== W.pattern.time ? fmtTime(x.time) : '', x.note, x.celebrant].filter(Boolean).join(' · ');
        html += `<li class="sun${x.changed ? ' sun--changed' : ''}${x.lang === 'No service' ? ' sun--off' : ''}">
          <div class="sun__row"><span>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><strong>${esc(langLabel(x))}</strong></div>
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
  if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !window.__MTCA_FAKE_SB) {
    const last = new Date(sun); last.setDate(last.getDate() + 42);
    const range = `day=gte.${ymd(sun)}&day=lte.${ymd(last)}`;
    const get = (path) => fetch(`${CFG.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: CFG.SUPABASE_ANON_KEY } }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    Promise.all([
      get('portal_settings?key=eq.worship&select=value'),
      get(`worship_services?${range}&select=day,language,time,note,celebrant`),
      up && up.hasAttribute('data-with-readings') ? get(`ref_lectionary?${range}&select=day,title,lessons,epistle_gospel,evening,songs`) : []
    ]).then(([setting, changes, lect]) => {
      if (setting[0] && setting[0].value) W.pattern = { ...W.pattern, ...setting[0].value, schedule: { ...W.pattern.schedule, ...(setting[0].value.schedule || {}) } };
      W.changes = Object.fromEntries(changes.map((c) => [c.day, { ...c, time: c.time ? c.time.slice(0, 5) : null }]));
      W.lect = Object.fromEntries(lect.map((l) => [l.day, l]));
      renderSundays();
    });
  } else if (window.__MTCA_FAKE_SB && window.__FAKE_SEED) { // preview / tests
    const db = window.__FAKE_SEED.db || {};
    const sv = (db.portal_settings || []).find((r) => r.key === 'worship');
    if (sv) W.pattern = { ...W.pattern, ...sv.value, schedule: { ...W.pattern.schedule, ...(sv.value.schedule || {}) } };
    W.changes = Object.fromEntries((db.worship_services || []).map((c) => [c.day, { ...c, time: c.time ? c.time.slice(0, 5) : null }]));
    W.lect = Object.fromEntries((db.ref_lectionary || []).map((l) => [l.day, l]));
    renderSundays();
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
