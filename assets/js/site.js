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

  // Sunday language: 1st & 3rd Malayalam, 2nd & 4th English
  const LANG = { 1: 'Malayalam', 2: 'English', 3: 'Malayalam', 4: 'English', 5: 'Special' }; // 5th Sundays — adjust if the parish has a set pattern
  const nextSunday = (from) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    // After noon on Sunday, roll to next week
    const add = (7 - d.getDay()) % 7 || (from.getHours() >= 12 ? 7 : 0);
    d.setDate(d.getDate() + add);
    return d;
  };
  const nth = (d) => Math.ceil(d.getDate() / 7);
  const fmt = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const sun = nextSunday(new Date());
  document.querySelectorAll('[data-sunday-language]').forEach((el) => { el.textContent = LANG[nth(sun)]; });
  document.querySelectorAll('[data-sunday-date]').forEach((el) => { el.textContent = fmt(sun); });

  const up = document.querySelector('[data-upcoming-sundays]');
  if (up) {
    const d = new Date(sun);
    for (let i = 0; i < 5; i++) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><strong>${LANG[nth(d)]}</strong>`;
      up.appendChild(li);
      d.setDate(d.getDate() + 7);
    }
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
