// Mitra AI — the parish chat assistant (floating chat bubble).
// Talks to the Supabase "chat" function; the conversation stays in this browser tab only.
(function () {
  const CFG = window.MTCA_CONFIG || {};
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return;
  const ENDPOINT = CFG.SUPABASE_URL + '/functions/v1/chat';
  const STORE = 'mtca-chat-v1';
  const SUGGESTIONS = ['What time is Sunday service?', 'Is this Sunday in English or Malayalam?', 'What’s coming up this month?', 'How do I contact the Vicar?'];
  const EMAIL = 'marthomachurchatlanta@gmail.com';
  const CONTACT_URL = new URL((window.MTCA_SITE && window.MTCA_SITE.contact) || '/contact-us/', location.href).href;
  let greeting = 'Hi! I’m Mitra AI, the assistant for Mar Thoma Church, Atlanta. Ask me about service times, upcoming events, our organizations or how to reach the church office.';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Small, safe markdown: links, bold, bullet lists, line breaks
  function render(text) {
    const lines = esc(text).split('\n');
    let html = '', inList = false;
    for (const raw of lines) {
      let l = raw
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
        .replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.]+)/g, '$1<a href="mailto:$2">$2</a>');
      const li = l.match(/^\s*[-*•]\s+(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      html += l.trim() ? `<p>${l}</p>` : '';
    }
    if (inList) html += '</ul>';
    return html;
  }

  let messages = [];
  try { messages = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch (e) { messages = []; }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-30))); } catch (e) { /* private mode */ } };

  const root = document.createElement('div');
  root.className = 'chatw';
  root.innerHTML = `
    <button class="chatw__launcher" aria-expanded="false" aria-controls="chatw-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>
      <span>Ask Mitra AI</span>
    </button>
    <section class="chatw__panel" id="chatw-panel" role="dialog" aria-label="Mitra AI" hidden>
      <header class="chatw__head">
        <div class="chatw__avatar" aria-hidden="true">☩</div>
        <div><strong>Mitra AI</strong><small>Mar Thoma Church, Atlanta</small></div>
        <button class="chatw__icon" data-reset title="Start over" aria-label="Start a new conversation"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg></button>
        <button class="chatw__icon" data-close aria-label="Close chat"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="chatw__log" aria-live="polite"></div>
      <div class="chatw__chips"></div>
      <form class="chatw__form">
        <textarea rows="1" maxlength="1000" placeholder="Type your question…" aria-label="Your question"></textarea>
        <button type="submit" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg></button>
      </form>
      <p class="chatw__note">Mitra AI can make mistakes. For pastoral care, please contact the Vicar.</p>
    </section>`;
  document.body.appendChild(root);

  const launcher = root.querySelector('.chatw__launcher');
  const panel = root.querySelector('.chatw__panel');
  const log = root.querySelector('.chatw__log');
  const chips = root.querySelector('.chatw__chips');
  const form = root.querySelector('.chatw__form');
  const input = form.querySelector('textarea');
  let busy = false;

  function draw() {
    log.innerHTML = `<div class="chatw__msg chatw__msg--bot">${render(greeting)}</div>` +
      messages.map((m) => `<div class="chatw__msg chatw__msg--${m.role === 'user' ? 'me' : m.error ? 'err' : 'bot'}">${m.role === 'user' ? `<p>${esc(m.content)}</p>` : render(m.content)}</div>`).join('') +
      (busy ? '<div class="chatw__msg chatw__msg--bot chatw__typing" aria-label="Mitra AI is typing"><i></i><i></i><i></i></div>' : '');
    chips.innerHTML = messages.length ? '' : SUGGESTIONS.map((s) => `<button type="button">${esc(s)}</button>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  function open(on) {
    panel.hidden = !on;
    launcher.setAttribute('aria-expanded', String(on));
    root.classList.toggle('is-open', on);
    if (on) { draw(); setTimeout(() => input.focus(), 50); }
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    messages.push({ role: 'user', content: text });
    busy = true; save(); draw();
    try {
      const history = messages.filter((m) => !m.error).slice(-12).map(({ role, content }) => ({ role, content }));
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ messages: history })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.reply) {
        const fallback = data.code === 'not_configured' || data.code === 'disabled'
          ? `The online assistant isn’t available right now. You can email the church at ${EMAIL} or see the [Contact page](${CONTACT_URL}).`
          : (data.error || 'Sorry — I couldn’t reach the assistant. Please try again.');
        messages.push({ role: 'assistant', content: fallback, error: true });
      } else {
        messages.push({ role: 'assistant', content: data.reply });
      }
    } catch (e) {
      messages.push({ role: 'assistant', content: `Sorry — I couldn’t connect. Please check your connection, or email ${EMAIL}.`, error: true });
    }
    busy = false; save(); draw();
  }

  launcher.addEventListener('click', () => open(panel.hidden));
  root.querySelector('[data-close]').addEventListener('click', () => { open(false); launcher.focus(); });
  root.querySelector('[data-reset]').addEventListener('click', () => { messages = []; save(); draw(); input.focus(); });
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) send(b.textContent); });
  form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value; input.value = ''; input.style.height = ''; send(t); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { open(false); launcher.focus(); } });

  // Admin can switch the assistant off or change the greeting (Portal Settings)
  fetch(`${CFG.SUPABASE_URL}/rest/v1/portal_settings?key=eq.chat&select=value`, { headers: { apikey: CFG.SUPABASE_ANON_KEY } })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => {
      const s = rows && rows[0] && rows[0].value;
      if (s && s.enabled === false) { root.remove(); return; }
      if (s && s.greeting) { greeting = s.greeting; if (!panel.hidden) draw(); }
      root.classList.add('is-ready');
    })
    .catch(() => root.classList.add('is-ready'));
})();
