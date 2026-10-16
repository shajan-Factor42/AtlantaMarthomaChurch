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
        <button class="chatw__icon chatw__speak" data-speak hidden aria-pressed="false" title="Read replies aloud" aria-label="Read replies aloud"><svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="on" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/><path class="off" d="M16 9.5l5 5M21 9.5l-5 5"/></svg></button>
        <button class="chatw__icon" data-reset title="Start over" aria-label="Start a new conversation"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg></button>
        <button class="chatw__icon" data-close aria-label="Close chat"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="chatw__log" aria-live="polite"></div>
      <div class="chatw__chips"></div>
      <form class="chatw__form">
        <button type="button" class="chatw__lang" data-lang hidden title="Language you will speak in" aria-label="Speaking language: English">EN</button>
        <textarea rows="1" maxlength="1000" placeholder="Type your question…" aria-label="Your question"></textarea>
        <button type="button" class="chatw__mic" data-mic hidden aria-pressed="false" aria-label="Speak your question" title="Speak your question"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>
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
    if (on) { draw(); setTimeout(() => input.focus(), 50); } else { voice.stop(); }
  }

  async function send(text, viaVoice) {
    text = text.trim();
    if (!text || busy) return;
    let spokenReply = '';
    voice.stop();
    if (viaVoice || voice.speakerOn()) voice.unlock();
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
        spokenReply = data.reply;
      }
    } catch (e) {
      messages.push({ role: 'assistant', content: `Sorry — I couldn’t connect. Please check your connection, or email ${EMAIL}.`, error: true });
    }
    busy = false; save(); draw();
    if (spokenReply && (viaVoice || voice.speakerOn())) voice.say(spokenReply);
  }

  // ---------- Voice: speak a question, hear the answer (browser built-in speech, no extra cost) ----------
  const voice = (function () {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const synth = window.speechSynthesis;
    const micBtn = form.querySelector('[data-mic]');
    const langBtn = form.querySelector('[data-lang]');
    const spkBtn = root.querySelector('[data-speak]');
    const PREF = 'mtca-chat-voice';
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch (e) { pref = {}; }
    const keep = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch (e) { /* storage blocked */ } };
    const LANGS = { 'en-US': ['EN', 'English'], 'ml-IN': ['മല', 'Malayalam'] };
    let lang = LANGS[pref.lang] ? pref.lang : 'en-US';
    let rec = null, listening = false, baseText = '';

    function setLang(l) {
      lang = l; pref.lang = l; keep();
      langBtn.textContent = LANGS[l][0];
      langBtn.setAttribute('aria-label', 'Speaking language: ' + LANGS[l][1] + ' (tap to change)');
      langBtn.title = 'Speaking ' + LANGS[l][1] + ' — tap to change';
    }
    function setSpeaker(on) {
      pref.speak = on; keep();
      spkBtn.setAttribute('aria-pressed', String(on));
      spkBtn.classList.toggle('is-on', on);
      const lbl = on ? 'Reading replies aloud (tap to turn off)' : 'Read replies aloud'; spkBtn.title = lbl; spkBtn.setAttribute('aria-label', lbl);
      if (!on) stop();
    }

    // Turn a markdown reply into something pleasant to hear
    function plain(t) {
      return String(t)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/https?:\/\/\S+/g, 'the link shown')
        .replace(/^\s*[-*•]\s+/gm, '')
        .replace(/[#*_`>]/g, '')
        .replace(/\n{2,}/g, '. ').replace(/\n/g, ', ')
        .replace(/\s+/g, ' ').trim();
    }
    function pickVoice(code) {
      const vs = synth.getVoices();
      const pre = code.slice(0, 2).toLowerCase();
      return vs.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-') === code.toLowerCase() && v.localService) ||
        vs.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-') === code.toLowerCase()) ||
        vs.find((v) => v.lang && v.lang.toLowerCase().startsWith(pre)) || null;
    }
    function say(text) {
      if (!synth) return;
      stop();
      const t = plain(text);
      if (!t) return;
      const malayalam = /[\u0D00-\u0D7F]/.test(t);
      const code = malayalam ? 'ml-IN' : 'en-US';
      const v = pickVoice(code);
      if (malayalam && !v) return; // no Malayalam voice on this device — don't read it in an English accent
      // Short pieces: some browsers cut off long utterances
      const parts = t.match(/[^.!?।]+[.!?।]*\s*/g) || [t];
      const chunks = [];
      for (const p of parts) {
        if (chunks.length && (chunks[chunks.length - 1] + p).length < 200) chunks[chunks.length - 1] += p; else chunks.push(p);
      }
      for (const c of chunks) {
        const u = new SpeechSynthesisUtterance(c.trim());
        u.lang = code; if (v) u.voice = v; u.rate = 1;
        synth.speak(u);
      }
    }
    function stop() { try { if (synth && (synth.speaking || synth.pending)) synth.cancel(); } catch (e) { /* ignore */ } }
    // iPhone/iPad only allow speech that starts from a tap, so "warm up" during the tap
    function unlock() { try { if (synth && !synth.speaking) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } } catch (e) { /* ignore */ } }

    function setListening(on) {
      listening = on;
      micBtn.classList.toggle('is-live', on);
      micBtn.setAttribute('aria-pressed', String(on));
      micBtn.setAttribute('aria-label', on ? 'Stop listening' : 'Speak your question');
      input.placeholder = on ? (lang === 'ml-IN' ? 'കേൾക്കുന്നു… സംസാരിക്കൂ' : 'Listening… go ahead') : 'Type your question…';
    }
    function listen() {
      if (listening) { rec && rec.stop(); return; }
      if (busy) return;
      stop(); unlock();
      rec = new SR();
      rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      baseText = input.value.trim() ? input.value.trim() + ' ' : '';
      let finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        input.value = baseText + finalText + interim;
        input.dispatchEvent(new Event('input'));
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          messages.push({ role: 'assistant', content: 'I can’t hear you — microphone access is blocked. Allow the microphone for this site in your browser settings, or just type your question.', error: true });
          draw();
        } else if (e.error === 'language-not-supported') {
          messages.push({ role: 'assistant', content: 'This browser can’t listen in ' + LANGS[lang][1] + '. Try English, or type your question.', error: true });
          draw();
        }
      };
      rec.onend = () => {
        setListening(false);
        const text = input.value.trim();
        if (finalText.trim() && text) { input.value = ''; input.style.height = ''; send(text, true); }
      };
      try { rec.start(); setListening(true); } catch (e) { setListening(false); }
    }

    function enable() {
      if (synth) {
        spkBtn.hidden = false;
        setSpeaker(!!pref.speak);
        spkBtn.addEventListener('click', () => { setSpeaker(!pref.speak); if (pref.speak) unlock(); });
        synth.getVoices(); // starts loading the voice list
      }
      if (SR && window.isSecureContext) {
        micBtn.hidden = false; langBtn.hidden = false;
        setLang(lang);
        micBtn.addEventListener('click', listen);
        langBtn.addEventListener('click', () => setLang(lang === 'en-US' ? 'ml-IN' : 'en-US'));
        root.classList.add('has-voice');
      }
    }
    function disable() {
      stop(); if (rec && listening) rec.abort();
      micBtn.hidden = langBtn.hidden = spkBtn.hidden = true;
      root.classList.remove('has-voice');
    }

    return { say, stop, unlock, enable, disable, speakerOn: () => !!(synth && pref.speak && !spkBtn.hidden) };
  })();
  voice.enable();

  launcher.addEventListener('click', () => open(panel.hidden));
  root.querySelector('[data-close]').addEventListener('click', () => { open(false); launcher.focus(); });
  root.querySelector('[data-reset]').addEventListener('click', () => { voice.stop(); messages = []; save(); draw(); input.focus(); });
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
      if (s && s.voice === false) voice.disable();
      root.classList.add('is-ready');
    })
    .catch(() => root.classList.add('is-ready'));
})();
