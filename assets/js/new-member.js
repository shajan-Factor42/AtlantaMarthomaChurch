// New Members form → Supabase function "new-member" (saved for Admin and emailed to the Vicar & Secretary)
(function () {
  const form = document.getElementById('new-member-form');
  if (!form) return;
  const CFG = window.MTCA_CONFIG || {};
  const started = Date.now();
  const RELS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Grandparent', 'Sibling', 'Other'];
  const list = document.getElementById('nm-family');
  const msg = form.querySelector('.nm-msg');

  function addPerson(rel) {
    if (list.children.length >= 10) return;
    const row = document.createElement('div');
    row.className = 'nm-person';
    row.innerHTML = `
      <label>First name<input data-f="first_name" maxlength="80"></label>
      <label>Last name<input data-f="last_name" maxlength="80" placeholder="Same as yours"></label>
      <label>Relationship<select data-f="relationship">${RELS.map((r) => `<option ${r === rel ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Date of birth <span class="opt">(optional)</span><input type="date" data-f="date_of_birth"></label>
      <button type="button" class="nm-person__remove" aria-label="Remove this person" title="Remove">×</button>`;
    row.querySelector('.nm-person__remove').onclick = () => row.remove();
    list.appendChild(row);
    return row;
  }
  addPerson('Spouse');
  document.getElementById('nm-add-person').onclick = () => { const r = addPerson(list.children.length ? 'Son' : 'Spouse'); r && r.querySelector('input').focus(); };

  const say = (text, bad) => { msg.textContent = text; msg.classList.toggle('is-error', !!bad); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    say('');
    const f = form.elements;
    const need = [['first_name', 'your first name'], ['last_name', 'your last name'], ['email', 'your email'], ['phone', 'a phone number']];
    for (const [n, label] of need) {
      if (!f[n].value.trim()) { f[n].focus(); return say(`Please enter ${label}.`, true); }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim())) { f.email.focus(); return say('Please check your email address.', true); }
    const body = Object.fromEntries(['first_name', 'last_name', 'email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'home_parish', 'previous_parish', 'transfer_letter', 'moved_on', 'wedding_date', 'message', 'heard_from', 'website'].map((n) => [n, f[n].value.trim()]));
    body.organizations = [...form.querySelectorAll('input[name=organizations]:checked')].map((c) => c.value);
    body.family = [...list.children].map((row) => Object.fromEntries([...row.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value.trim()]))).filter((p) => p.first_name);
    body.elapsed_ms = Date.now() - started;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…';
    try {
      if (window.__MTCA_FAKE_NM) { await window.__MTCA_FAKE_NM(body); }
      else {
        if (!CFG.SUPABASE_URL) throw new Error('The form isn’t connected yet.');
        const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/new-member`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok || !out.ok) throw new Error(out.error || 'Sorry — something went wrong. Please try again.');
      }
      const done = document.getElementById('nm-done');
      done.querySelector('[data-nm-name]').textContent = body.first_name;
      form.hidden = true; done.hidden = false; done.focus();
      done.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      say(err.message || 'Sorry — something went wrong. Please try again, or email the church office.', true);
    } finally { btn.disabled = false; btn.textContent = label; }
  });
})();
