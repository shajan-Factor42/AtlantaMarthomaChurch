// Prayer request form → Supabase function "prayer-request" (private to the Vicar). Can be anonymous.
(function () {
  const form = document.getElementById('prayer-form');
  if (!form) return;
  const CFG = window.MTCA_CONFIG || {};
  let started = Date.now();
  const msg = form.querySelector('.nm-msg');
  const who = form.querySelector('.pr-who'), note = form.querySelector('.pr-anon-note');
  const say = (t, bad) => { msg.textContent = t; msg.classList.toggle('is-error', !!bad); };
  form.anonymous.addEventListener('change', () => { const a = form.anonymous.checked; who.hidden = a; note.hidden = !a; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); say('');
    const f = form.elements, anon = f.anonymous.checked;
    if (f.request.value.trim().length < 3) { f.request.focus(); return say('Please write your prayer request.', true); }
    if (!anon && f.email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim())) { f.email.focus(); return say('Please check your email address, or leave it blank.', true); }
    if (!anon && f.wants_contact.checked && !f.email.value.trim() && !f.phone.value.trim()) { f.phone.focus(); return say('Please add an email or phone number so the Vicar can reach you.', true); }
    const body = {
      anonymous: anon, request: f.request.value.trim(), for_whom: f.for_whom.value, share_ok: f.share_ok.checked,
      name: anon ? '' : f.name.value.trim(), email: anon ? '' : f.email.value.trim(), phone: anon ? '' : f.phone.value.trim(),
      wants_contact: !anon && f.wants_contact.checked, website: f.website.value, elapsed_ms: Date.now() - started
    };
    const btn = form.querySelector('button[type=submit]'); const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      if (window.__MTCA_FAKE_PR) await window.__MTCA_FAKE_PR(body);
      else {
        if (!CFG.SUPABASE_URL) throw new Error('The form isn’t connected yet.');
        const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/prayer-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok || !out.ok) throw new Error(out.error || 'Sorry — something went wrong. Please try again.');
      }
      const done = document.getElementById('pr-done');
      form.hidden = true; done.hidden = false; done.focus(); done.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { say(err.message || 'Sorry — something went wrong. Please try again, or call the Vicar.', true); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  document.getElementById('pr-another').onclick = () => {
    form.reset(); who.hidden = false; note.hidden = true; started = Date.now();
    document.getElementById('pr-done').hidden = true; form.hidden = false; form.request.focus();
  };
})();
