// Mar Thoma Church, Atlanta — member portal
// Talks to Supabase when configured; otherwise runs a local preview with sample data.

const CFG = window.MTCA_CONFIG || {};
const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;
const ORGS = (window.MTCA && window.MTCA.orgs) || [];
const PORTAL_URL = location.origin + location.pathname;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const date = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const val = (v) => (v === null || v === undefined || v === '') ? '<span class="muted">—</span>' : esc(v);

/* ---------------------------------------------------------------------
   Data layer
--------------------------------------------------------------------- */
function demoApi() {
  const y = new Date().getFullYear();
  const fam = { id: 'f1', family_name: 'Thomas, Varghese & Mary', member_number: 'MTCA-0142', address_line1: '1200 Peachtree Industrial Blvd', address_line2: '', city: 'Suwanee', state: 'GA', zip: '30024', home_phone: '(770) 555-0142', prayer_group: 'North Area', home_parish: 'Maramon', member_since: '2009-08-01', status: 'active' };
  const members = [
    { id: 'm1', family_id: 'f1', first_name: 'Varghese', last_name: 'Thomas', email: 'demo@example.com', mobile_phone: '(770) 555-0143', date_of_birth: '1971-04-12', relationship: 'Head', baptized: true, confirmed: true, wedding_date: '1998-05-23', role: 'admin', directory_opt_in: true, auth_user_id: 'u1' },
    { id: 'm2', family_id: 'f1', first_name: 'Mary', last_name: 'Thomas', email: 'mary@example.com', mobile_phone: '(770) 555-0144', date_of_birth: '1974-09-30', relationship: 'Spouse', baptized: true, confirmed: true, wedding_date: '1998-05-23', role: 'member', directory_opt_in: true, auth_user_id: null },
    { id: 'm3', family_id: 'f1', first_name: 'Anna', last_name: 'Thomas', email: '', mobile_phone: '', date_of_birth: '2006-02-17', relationship: 'Daughter', baptized: true, confirmed: true, role: 'member', directory_opt_in: false, auth_user_id: null },
    { id: 'm4', family_id: 'f1', first_name: 'Joel', last_name: 'Thomas', email: '', mobile_phone: '', date_of_birth: '2011-11-02', relationship: 'Son', baptized: true, confirmed: false, role: 'member', directory_opt_in: false, auth_user_id: null }
  ];
  const contributions = [];
  let n = 0;
  [y - 1, y].forEach((yr) => {
    const last = yr === y ? new Date().getMonth() : 11;
    for (let mo = 0; mo <= last; mo++) {
      const d = `${yr}-${String(mo + 1).padStart(2, '0')}`;
      contributions.push({ id: 'c' + n++, family_id: 'f1', given_on: `${d}-05`, category: 'Subscription', amount: 150, method: mo % 2 ? 'Zelle' : 'Check', reference: mo % 2 ? '' : String(2100 + n) });
      if (mo % 3 === 0) contributions.push({ id: 'c' + n++, family_id: 'f1', given_on: `${d}-19`, category: 'Mission', amount: 50, method: 'Check', reference: String(2100 + n) });
    }
    contributions.push({ id: 'c' + n++, family_id: 'f1', given_on: `${yr}-04-20`, category: 'Thanksgiving', amount: 250, method: 'Check', reference: String(2100 + n) });
  });
  const todayIso = new Date().toISOString().slice(0, 10);
  for (let i = contributions.length - 1; i >= 0; i--) if (contributions[i].given_on > todayIso) contributions.splice(i, 1);
  const pledges = [{ family_id: 'f1', year: y, category: 'Subscription', amount: 1800 }, { family_id: 'f1', year: y - 1, category: 'Subscription', amount: 1800 }];
  const orgMemberships = [
    { member_id: 'm1', organization: 'Choir', position: 'Member' },
    { member_id: 'm2', organization: 'Sevika Sangham', position: 'Secretary' },
    { member_id: 'm3', organization: 'Yuvajana Sakhyam', position: 'Member' },
    { member_id: 'm4', organization: 'Sunday School', position: 'Grade 9' }
  ];
  const announcements = [
    { id: 'a1', title: 'Parish General Body meeting', body: 'The annual General Body meeting will be held after worship on the last Sunday of the month. All communicant members are encouraged to attend.', published_on: `${y}-10-01` },
    { id: 'a2', title: 'Update your family details', body: 'Please review your address and phone numbers under My Profile and Family so the parish register is current.', published_on: `${y}-09-15` }
  ];
  const documents = [
    { id: 'd1', title: `Annual Report ${y - 1}`, category: 'Annual Report', url: '#', published_on: `${y}-02-01` },
    { id: 'd2', title: 'General Body minutes — January', category: 'Minutes', url: '#', published_on: `${y}-01-28` },
    { id: 'd3', title: 'Membership update form', category: 'Forms', url: '#', published_on: `${y}-01-05` }
  ];
  const otherFamilies = [
    { id: 'f2', family_name: 'Mathew, John & Susan', member_number: 'MTCA-0087', prayer_group: 'South Area', home_phone: '(678) 555-0187' },
    { id: 'f3', family_name: 'Cherian, Philip & Leena', member_number: 'MTCA-0203', prayer_group: 'East Area', home_phone: '(404) 555-0203' }
  ];
  const directory = [
    { first_name: 'Varghese', last_name: 'Thomas', family_name: fam.family_name, mobile_phone: '(770) 555-0143', email: 'demo@example.com', prayer_group: 'North Area' },
    { first_name: 'Mary', last_name: 'Thomas', family_name: fam.family_name, mobile_phone: '(770) 555-0144', email: 'mary@example.com', prayer_group: 'North Area' },
    { first_name: 'John', last_name: 'Mathew', family_name: 'Mathew, John & Susan', mobile_phone: '(678) 555-0188', email: 'john@example.com', prayer_group: 'South Area' },
    { first_name: 'Leena', last_name: 'Cherian', family_name: 'Cherian, Philip & Leena', mobile_phone: '(404) 555-0204', email: 'leena@example.com', prayer_group: 'East Area' }
  ];
  let signedIn = false;
  try { signedIn = sessionStorage.getItem('mtca-demo') === '1'; } catch (e) {}
  const listeners = [];
  const setSigned = (v) => { signedIn = v; try { v ? sessionStorage.setItem('mtca-demo', '1') : sessionStorage.removeItem('mtca-demo'); } catch (e) {} listeners.forEach((f) => f(v ? 'SIGNED_IN' : 'SIGNED_OUT')); };
  const wait = (x) => new Promise((r) => setTimeout(() => r(x), 150));

  return {
    demo: true,
    onAuth: (f) => listeners.push(f),
    session: async () => signedIn,
    signIn: async () => { setSigned(true); },
    magicLink: async () => 'In preview mode no email is sent — signing you in to the sample account.',
    forgot: async () => 'In preview mode no email is sent.',
    setPassword: async () => {},
    signOut: async () => setSigned(false),
    me: () => wait({ ...members[0], family: fam }),
    familyMembers: () => wait(members),
    contributions: () => wait(contributions),
    pledges: () => wait(pledges),
    orgMemberships: () => wait(orgMemberships),
    announcements: () => wait(announcements),
    documents: () => wait(documents),
    directory: () => wait(directory),
    updateFamily: async (p) => { Object.assign(fam, p); },
    updateMember: async (id, p) => { Object.assign(members.find((m) => m.id === id), p); },
    allFamilies: () => wait([fam, ...otherFamilies]),
    familyContributions: async (fid) => contributions.filter((c) => c.family_id === fid).slice(-10).reverse(),
    addContribution: async (c) => { contributions.push({ id: 'c' + n++, ...c }); },
    exportMembers: () => wait(members.map((m) => ({ ...m, family_name: fam.family_name })))
  };
}

async function supabaseApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  let me = null;

  return {
    demo: false,
    sb,
    onAuth: (f) => sb.auth.onAuthStateChange((event) => f(event)),
    session: async () => !!(await sb.auth.getSession()).data.session,
    signIn: async (email, password) => ok(await sb.auth.signInWithPassword({ email, password })),
    magicLink: async (email) => { ok(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: PORTAL_URL } })); return 'Check your email for a sign-in link.'; },
    forgot: async (email) => { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: PORTAL_URL })); return 'If that email is registered, a reset link is on its way.'; },
    setPassword: async (password) => ok(await sb.auth.updateUser({ password })),
    signOut: async () => { me = null; await sb.auth.signOut(); },
    me: async () => {
      if (me) return me;
      const { data: { user } } = await sb.auth.getUser();
      const row = ok(await sb.from('members').select('*, family:families(*)').eq('auth_user_id', user.id).maybeSingle());
      me = row ? row : { unlinked: true, email: user.email };
      return me;
    },
    familyMembers: async () => ok(await sb.from('members').select('*').eq('family_id', (await this_me()).family_id).order('date_of_birth', { ascending: true, nullsFirst: false })),
    contributions: async () => ok(await sb.from('contributions').select('*').eq('family_id', (await this_me()).family_id).order('given_on', { ascending: false })),
    pledges: async () => ok(await sb.from('pledges').select('*').eq('family_id', (await this_me()).family_id)),
    orgMemberships: async () => ok(await sb.from('organization_memberships').select('*')),
    announcements: async () => ok(await sb.from('member_announcements').select('*').order('published_on', { ascending: false }).limit(20)),
    documents: async () => ok(await sb.from('member_documents').select('*').order('published_on', { ascending: false })),
    directory: async () => ok(await sb.rpc('member_directory')),
    updateFamily: async (p) => { ok(await sb.rpc('update_my_family', { p_address_line1: p.address_line1, p_address_line2: p.address_line2, p_city: p.city, p_state: p.state, p_zip: p.zip, p_home_phone: p.home_phone })); me = null; },
    updateMember: async (id, p) => { ok(await sb.rpc('update_family_member', { p_member_id: id, p_mobile_phone: p.mobile_phone, p_email: p.email, p_date_of_birth: p.date_of_birth || null, p_directory_opt_in: !!p.directory_opt_in })); me = null; },
    allFamilies: async () => ok(await sb.from('families').select('id, family_name, member_number, prayer_group, home_phone').order('family_name')),
    familyContributions: async (fid) => ok(await sb.from('contributions').select('*').eq('family_id', fid).order('given_on', { ascending: false }).limit(10)),
    addContribution: async (c) => ok(await sb.from('contributions').insert(c)),
    exportMembers: async () => ok(await sb.from('members').select('first_name, last_name, email, mobile_phone, date_of_birth, relationship, role, family:families(family_name, member_number, address_line1, city, state, zip, prayer_group)'))
  };
  async function this_me() { const m = await api.me(); if (m.unlinked) throw new Error('Not linked'); return m; }
}

let api;

/* ---------------------------------------------------------------------
   Auth screens
--------------------------------------------------------------------- */
const authView = $('#auth-view');
const appView = $('#app-view');
const loading = $('#loading');
const loginForm = $('#login-form');
const resetForm = $('#reset-form');

function msg(form, text, isError) {
  const el = $('.form__msg', form);
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}
function busy(form, on) { $$('button', form).forEach((b) => (b.disabled = on)); }
const friendly = (e) => {
  const m = (e && e.message) || String(e);
  if (/invalid login/i.test(m)) return 'That email and password don’t match. Try again, or use “Email me a sign-in link”.';
  if (/signups not allowed|user not found/i.test(m)) return 'We couldn’t find that email. Please contact the church secretary to be invited.';
  if (/rate limit/i.test(m)) return 'Too many attempts — please wait a minute and try again.';
  return m;
};

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginForm.email.value.trim();
  const password = loginForm.password.value;
  if (!email) return msg(loginForm, 'Please enter your email.', true);
  if (!password && !api.demo) return msg(loginForm, 'Enter your password, or use “Email me a sign-in link”.', true);
  busy(loginForm, true); msg(loginForm, 'Signing in…');
  try { await api.signIn(email, password); msg(loginForm, ''); await route(); }
  catch (err) { msg(loginForm, friendly(err), true); }
  finally { busy(loginForm, false); }
});

loginForm.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  const email = loginForm.email.value.trim();
  if (!email) { loginForm.email.focus(); return msg(loginForm, 'Enter your email first.', true); }
  busy(loginForm, true);
  try {
    const text = action === 'magic' ? await api.magicLink(email) : await api.forgot(email);
    msg(loginForm, text);
    if (api.demo && action === 'magic') { await api.signIn(); await route(); }
  } catch (err) { msg(loginForm, friendly(err), true); }
  finally { busy(loginForm, false); }
});

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = resetForm.password.value, c = resetForm.confirm.value;
  if (p.length < 8) return msg(resetForm, 'Use at least 8 characters.', true);
  if (p !== c) return msg(resetForm, 'The passwords don’t match.', true);
  busy(resetForm, true);
  try { await api.setPassword(p); recovering = false; history.replaceState(null, '', PORTAL_URL); resetForm.hidden = true; await route(); }
  catch (err) { msg(resetForm, friendly(err), true); }
  finally { busy(resetForm, false); }
});

$('#sign-out').addEventListener('click', async () => { await api.signOut(); await route(); });

/* ---------------------------------------------------------------------
   Portal views
--------------------------------------------------------------------- */
const view = $('#view');
let current = 'overview';
let ctx = {};

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) show(b.dataset.tab);
});

async function show(tab) {
  current = tab;
  $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  view.innerHTML = '<p class="muted">Loading…</p>';
  try { view.innerHTML = await VIEWS[tab](); BIND[tab] && BIND[tab](); }
  catch (err) { view.innerHTML = `<div class="notice notice--error">Something went wrong loading this page. ${esc(friendly(err))}</div>`; }
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
}

const age = (dob) => { if (!dob) return ''; const d = new Date(dob), t = new Date(); let a = t.getFullYear() - d.getFullYear(); if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const field = (label, v) => `<div class="kv"><dt>${label}</dt><dd>${val(v)}</dd></div>`;
const yesno = (b) => b === true ? 'Yes' : b === false ? 'No' : '';

const VIEWS = {
  async overview() {
    const [me, contribs, pledges, anns] = await Promise.all([api.me(), api.contributions(), api.pledges(), api.announcements()]);
    const y = new Date().getFullYear();
    const ytd = contribs.filter((c) => c.given_on.startsWith(String(y))).reduce((s, c) => s + Number(c.amount), 0);
    const pledge = pledges.filter((p) => p.year === y).reduce((s, p) => s + Number(p.amount), 0);
    const subs = contribs.filter((c) => c.given_on.startsWith(String(y)) && c.category === 'Subscription').reduce((s, c) => s + Number(c.amount), 0);
    const last = contribs.slice().sort((a, b) => b.given_on.localeCompare(a.given_on))[0];
    const pct = pledge ? Math.min(100, Math.round((subs / pledge) * 100)) : 0;
    return `
      <div class="stats">
        <div class="stat"><span>${y} giving to date</span><strong>${money(ytd)}</strong></div>
        <div class="stat"><span>Subscription pledge</span><strong>${pledge ? money(pledge) : '—'}</strong>
          ${pledge ? `<div class="meter" role="img" aria-label="${pct}% of pledge"><i style="width:${pct}%"></i></div><small>${money(subs)} paid · ${pct}%</small>` : ''}</div>
        <div class="stat"><span>Last contribution</span><strong>${last ? money(last.amount) : '—'}</strong><small>${last ? date(last.given_on) + ' · ' + esc(last.category) : ''}</small></div>
        <div class="stat"><span>Member number</span><strong>${val(me.family.member_number)}</strong><small>${val(me.family.prayer_group)}</small></div>
      </div>
      <div class="grid-2">
        <section class="pcard">
          <h2>Announcements</h2>
          ${anns.length ? anns.map((a) => `<article class="ann"><p class="ann__date">${date(a.published_on)}</p><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></article>`).join('') : '<p class="muted">No announcements right now.</p>'}
        </section>
        <section class="pcard">
          <h2>Quick links</h2>
          <ul class="quick">
            <li><button data-go="profile">Review my contact details</button></li>
            <li><button data-go="family">Update family members</button></li>
            <li><button data-go="giving">Print my ${y} giving statement</button></li>
            <li><button data-go="documents">Members-only documents</button></li>
          </ul>
        </section>
      </div>`;
  },

  async profile() {
    const me = await api.me();
    const f = me.family;
    return `
      <div class="grid-2">
        <section class="pcard">
          <div class="pcard__head"><h2>${esc(me.first_name)} ${esc(me.last_name)}</h2><button class="btn btn--outline btn--small" data-edit-member="${esc(me.id)}">Edit</button></div>
          <dl class="kvs">
            ${field('Email (login)', me.email)}
            ${field('Mobile', me.mobile_phone)}
            ${field('Date of birth', me.date_of_birth && date(me.date_of_birth))}
            ${field('Relationship', me.relationship)}
            ${field('Baptized', yesno(me.baptized))}
            ${field('Confirmed', yesno(me.confirmed))}
            ${field('Wedding date', me.wedding_date && date(me.wedding_date))}
            ${field('Listed in directory', me.directory_opt_in ? 'Yes' : 'No')}
          </dl>
        </section>
        <section class="pcard">
          <div class="pcard__head"><h2>Household</h2><button class="btn btn--outline btn--small" id="edit-family">Edit address</button></div>
          <dl class="kvs">
            ${field('Family', f.family_name)}
            ${field('Member number', f.member_number)}
            ${field('Address', [f.address_line1, f.address_line2, [f.city, f.state].filter(Boolean).join(', ') + ' ' + (f.zip || '')].filter((x) => x && x.trim()).join('\n'))}
            ${field('Home phone', f.home_phone)}
            ${field('Prayer group', f.prayer_group)}
            ${field('Home parish', f.home_parish)}
            ${field('Member since', f.member_since && date(f.member_since))}
          </dl>
          <p class="muted small">To change your family name, member number, prayer group or sacramental records, please contact the church secretary.</p>
        </section>
      </div>`;
  },

  async family() {
    const members = await api.familyMembers();
    return `
      <section class="pcard">
        <div class="pcard__head"><h2>Family members</h2></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Relationship</th><th>Age</th><th>Mobile</th><th>Email</th><th></th></tr></thead>
          <tbody>${members.map((m) => `
            <tr><td><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong></td><td>${val(m.relationship)}</td><td>${val(age(m.date_of_birth))}</td>
            <td>${val(m.mobile_phone)}</td><td>${val(m.email)}</td>
            <td><button class="link-btn" data-edit-member="${esc(m.id)}">Edit</button></td></tr>`).join('')}
          </tbody></table></div>
        <p class="muted small">Need to add a new baby, a spouse, or record a move? Contact the church secretary so the parish register is updated.</p>
      </section>`;
  },

  async giving() {
    const [contribs, pledges, me] = await Promise.all([api.contributions(), api.pledges(), api.me()]);
    const years = [...new Set(contribs.map((c) => +c.given_on.slice(0, 4)).concat(new Date().getFullYear()))].sort((a, b) => b - a);
    ctx.giving = { contribs, pledges, me, years };
    return `
      <div class="pcard__head no-print">
        <label class="inline">Year
          <select id="giving-year">${years.map((y) => `<option>${y}</option>`).join('')}</select>
        </label>
        <button class="btn btn--primary btn--small" onclick="window.print()">Print statement</button>
      </div>
      <div id="statement"></div>`;
  },

  async organizations() {
    const [members, oms] = await Promise.all([api.familyMembers(), api.orgMemberships()]);
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    const mine = oms.filter((o) => byId[o.member_id]);
    return `
      <section class="pcard">
        <h2>Your family’s organizations</h2>
        ${mine.length ? `<div class="org-grid">${mine.map((o) => `<div class="org"><strong>${esc(o.organization)}</strong><span>${esc(byId[o.member_id].first_name)}${o.position ? ' · ' + esc(o.position) : ''}</span></div>`).join('')}</div>` : '<p class="muted">No organization memberships recorded yet.</p>'}
        <p class="muted small">Want to join ${ORGS.length ? esc(ORGS.slice(0, 3).join(', ')) + ' or another group' : 'an organization'}? Speak to the organization’s secretary or the church office.</p>
      </section>`;
  },

  async directory() {
    const rows = await api.directory();
    ctx.directory = rows;
    return `
      <section class="pcard">
        <div class="pcard__head"><h2>Parish directory</h2><input type="search" id="dir-q" placeholder="Search name or area" aria-label="Search directory"></div>
        <p class="muted small">Only members who choose “List me in the directory” appear here. You can change yours under My Profile.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Family</th><th>Mobile</th><th>Email</th><th>Prayer group</th></tr></thead><tbody id="dir-rows"></tbody></table></div>
      </section>`;
  },

  async documents() {
    const docs = await api.documents();
    const cats = [...new Set(docs.map((d) => d.category || 'General'))];
    return cats.length ? cats.map((c) => `
      <section class="pcard">
        <h2>${esc(c)}</h2>
        <ul class="doc-list">${docs.filter((d) => (d.category || 'General') === c).map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener"><span class="doc-icon">DOC</span><span>${esc(d.title)} <small class="muted">· ${date(d.published_on)}</small></span></a></li>`).join('')}</ul>
      </section>`).join('') : '<section class="pcard"><p class="muted">No documents have been posted yet.</p></section>';
  },

  async account() {
    const me = await api.me();
    return `
      <div class="grid-2">
        <section class="pcard">
          <h2>Password</h2>
          <p class="muted small">Signed in as <strong>${esc(me.email)}</strong>. If you signed in with an email link, you can set a password here for next time.</p>
          <form id="pw-form" class="form form--flat">
            <label>New password<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
            <label>Confirm password<input type="password" name="confirm" minlength="8" autocomplete="new-password" required></label>
            <button class="btn btn--primary" type="submit">Update password</button>
            <p class="form__msg" role="status"></p>
          </form>
        </section>
        <section class="pcard">
          <h2>Privacy</h2>
          <p>Your information is visible only to your own family and to the parish officers who maintain the register. Contact details appear in the parish directory only if you opt in.</p>
          <p>To change your login email or remove your account, contact <a href="mailto:secretary@mtcatlanta.org">the church secretary</a>.</p>
        </section>
      </div>`;
  },

  async officer() {
    const fams = await api.allFamilies();
    ctx.families = fams;
    const today = new Date().toISOString().slice(0, 10);
    return `
      <div class="grid-2">
        <section class="pcard">
          <h2>Record a contribution</h2>
          <form id="contrib-form" class="form form--flat">
            <label>Family<select name="family_id" required><option value="">Choose a family…</option>${fams.map((f) => `<option value="${esc(f.id)}">${esc(f.family_name)}${f.member_number ? ' (' + esc(f.member_number) + ')' : ''}</option>`).join('')}</select></label>
            <div class="row-2">
              <label>Date<input type="date" name="given_on" value="${today}" required></label>
              <label>Amount ($)<input type="number" name="amount" min="0" step="0.01" required></label>
            </div>
            <div class="row-2">
              <label>Category<select name="category">${['Subscription', 'Sunday Offering', 'Thanksgiving', 'Mission', 'Building Fund', 'Harvest Festival', 'Other'].map((c) => `<option>${c}</option>`).join('')}</select></label>
              <label>Method<select name="method">${['Check', 'Zelle', 'Cash', 'Online'].map((c) => `<option>${c}</option>`).join('')}</select></label>
            </div>
            <label>Reference / check #<input name="reference"></label>
            <button class="btn btn--primary" type="submit">Save contribution</button>
            <p class="form__msg" role="status"></p>
          </form>
        </section>
        <section class="pcard">
          <h2>Recent entries</h2>
          <div id="recent" class="muted small">Choose a family to see its recent contributions.</div>
          <hr>
          <h2>Export</h2>
          <p class="muted small">Download the full member register as a spreadsheet (CSV).</p>
          <button class="btn btn--outline btn--small" id="export">Download members CSV</button>
        </section>
      </div>`;
  }
};

function renderStatement(year) {
  const { contribs, pledges, me } = ctx.giving;
  const rows = contribs.filter((c) => c.given_on.startsWith(String(year))).sort((a, b) => a.given_on.localeCompare(b.given_on));
  const total = rows.reduce((s, c) => s + Number(c.amount), 0);
  const byCat = rows.reduce((m, c) => ((m[c.category] = (m[c.category] || 0) + Number(c.amount)), m), {});
  const pledge = pledges.filter((p) => p.year === +year);
  const f = me.family;
  $('#statement').innerHTML = `
    <section class="pcard statement">
      <div class="statement__head">
        <div><h2>Contribution statement ${year}</h2>
          <p>${esc(f.family_name)}${f.member_number ? ' · ' + esc(f.member_number) : ''}<br>${esc([f.address_line1, f.city, f.state, f.zip].filter(Boolean).join(', '))}</p></div>
        <div class="statement__total"><span>Total given</span><strong>${money(total)}</strong></div>
      </div>
      <div class="cat-row">${Object.entries(byCat).map(([k, v]) => `<div><span>${esc(k)}</span><strong>${money(v)}</strong></div>`).join('') || '<p class="muted">No contributions recorded for this year.</p>'}</div>
      ${pledge.length ? `<p class="small">Pledged: ${pledge.map((p) => `${esc(p.category)} ${money(p.amount)}`).join(' · ')}</p>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="table table--compact">
        <thead><tr><th>Date</th><th>Category</th><th>Method</th><th>Ref.</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows.map((c) => `<tr><td>${date(c.given_on)}</td><td>${esc(c.category)}</td><td>${val(c.method)}</td><td>${val(c.reference)}</td><td class="num">${money(c.amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">Total</td><td class="num">${money(total)}</td></tr></tfoot></table></div>` : ''}
      <p class="small muted statement__note">No goods or services were provided in exchange for these contributions. Please keep this statement for your tax records. Questions? Contact the trustees at trustee@mtcatlanta.org.</p>
    </section>`;
}

/* Edit dialogs */
function dialog(title, bodyHtml, onSave) {
  const d = document.createElement('dialog');
  d.className = 'dlg';
  d.innerHTML = `<form method="dialog" class="form form--flat"><h2>${title}</h2>${bodyHtml}
    <div class="dlg__actions"><button value="cancel" class="btn btn--outline btn--small" formnovalidate>Cancel</button><button value="save" class="btn btn--primary btn--small">Save</button></div>
    <p class="form__msg" role="status"></p></form>`;
  document.body.appendChild(d);
  const form = $('form', d);
  form.addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    busy(form, true);
    try { await onSave(Object.fromEntries(new FormData(form)), form); d.close(); await show(current); }
    catch (err) { msg(form, friendly(err), true); busy(form, false); }
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

async function editMember(id) {
  const members = await api.familyMembers();
  const m = members.find((x) => x.id === id);
  const hasLogin = !!m.auth_user_id;
  dialog(`Edit ${esc(m.first_name)}`, `
    <label>Mobile phone<input name="mobile_phone" type="tel" value="${esc(m.mobile_phone)}"></label>
    <label>Email<input name="email" type="email" value="${esc(m.email)}" ${hasLogin ? 'disabled' : ''}>${hasLogin ? '<small class="muted">This is a login email — contact the secretary to change it.</small>' : ''}</label>
    <label>Date of birth<input name="date_of_birth" type="date" value="${esc(m.date_of_birth)}"></label>
    <label class="check"><input type="checkbox" name="directory_opt_in" ${m.directory_opt_in ? 'checked' : ''}> List ${m.id === ctx.meId ? 'me' : 'them'} in the parish directory</label>`,
    (p) => api.updateMember(id, { ...p, email: hasLogin ? m.email : p.email, directory_opt_in: !!p.directory_opt_in }));
}

async function editFamily() {
  const f = (await api.me()).family;
  dialog('Edit household', `
    <label>Address line 1<input name="address_line1" value="${esc(f.address_line1)}" autocomplete="address-line1"></label>
    <label>Address line 2<input name="address_line2" value="${esc(f.address_line2)}" autocomplete="address-line2"></label>
    <div class="row-3">
      <label>City<input name="city" value="${esc(f.city)}" autocomplete="address-level2"></label>
      <label>State<input name="state" value="${esc(f.state)}" maxlength="2" autocomplete="address-level1"></label>
      <label>ZIP<input name="zip" value="${esc(f.zip)}" autocomplete="postal-code"></label>
    </div>
    <label>Home phone<input name="home_phone" type="tel" value="${esc(f.home_phone)}"></label>`,
    (p) => api.updateFamily(p));
}

const csv = (rows) => {
  const flat = rows.map((r) => { const o = { ...r }; if (o.family && typeof o.family === 'object') { Object.entries(o.family).forEach(([k, v]) => (o['family_' + k.replace(/^family_/, '')] = v)); delete o.family; } return o; });
  const cols = [...new Set(flat.flatMap(Object.keys))];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.map(q).join(','), ...flat.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
};

const BIND = {
  overview() { $$('[data-go]', view).forEach((b) => (b.onclick = () => show(b.dataset.go))); },
  profile() {
    $$('[data-edit-member]', view).forEach((b) => (b.onclick = () => editMember(b.dataset.editMember)));
    $('#edit-family').onclick = editFamily;
  },
  family() { $$('[data-edit-member]', view).forEach((b) => (b.onclick = () => editMember(b.dataset.editMember))); },
  giving() { const s = $('#giving-year'); s.onchange = () => renderStatement(s.value); renderStatement(s.value); },
  directory() {
    const draw = (q = '') => {
      const t = q.toLowerCase();
      const rows = ctx.directory.filter((r) => !t || Object.values(r).join(' ').toLowerCase().includes(t));
      $('#dir-rows').innerHTML = rows.map((r) => `<tr><td><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong></td><td>${val(r.family_name)}</td><td>${r.mobile_phone ? `<a href="tel:${esc(r.mobile_phone)}">${esc(r.mobile_phone)}</a>` : val('')}</td><td>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : val('')}</td><td>${val(r.prayer_group)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No matches.</td></tr>';
    };
    draw();
    $('#dir-q').oninput = (e) => draw(e.target.value);
  },
  account() {
    const f = $('#pw-form');
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.password.value.length < 8) return msg(f, 'Use at least 8 characters.', true);
      if (f.password.value !== f.confirm.value) return msg(f, 'The passwords don’t match.', true);
      busy(f, true);
      try { await api.setPassword(f.password.value); f.reset(); msg(f, 'Password updated.'); }
      catch (err) { msg(f, friendly(err), true); }
      finally { busy(f, false); }
    };
  },
  officer() {
    const f = $('#contrib-form');
    const loadRecent = async (fid) => {
      if (!fid) return;
      const rows = await api.familyContributions(fid);
      $('#recent').innerHTML = rows.length ? `<table class="table table--compact"><tbody>${rows.map((c) => `<tr><td>${date(c.given_on)}</td><td>${esc(c.category)}</td><td class="num">${money(c.amount)}</td></tr>`).join('')}</tbody></table>` : 'No contributions yet.';
    };
    f.family_id.onchange = () => loadRecent(f.family_id.value);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const p = Object.fromEntries(new FormData(f));
      if (!p.family_id || !p.amount) return msg(f, 'Choose a family and enter an amount.', true);
      busy(f, true);
      try {
        await api.addContribution({ ...p, amount: Number(p.amount) });
        msg(f, `Saved ${money(p.amount)} for ${ctx.families.find((x) => x.id === p.family_id).family_name}.`);
        f.amount.value = ''; f.reference.value = '';
        await loadRecent(p.family_id);
      } catch (err) { msg(f, friendly(err), true); }
      finally { busy(f, false); }
    };
    $('#export').onclick = async () => {
      const blob = new Blob([csv(await api.exportMembers())], { type: 'text/csv' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `mtca-members-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click(); URL.revokeObjectURL(a.href);
    };
  }
};

/* ---------------------------------------------------------------------
   Routing
--------------------------------------------------------------------- */
let recovering = false;

async function route() {
  loading.hidden = true;
  if (recovering) { authView.hidden = false; appView.hidden = true; loginForm.hidden = true; resetForm.hidden = false; return; }
  const signedIn = await api.session();
  if (!signedIn) { authView.hidden = false; appView.hidden = true; loginForm.hidden = false; resetForm.hidden = true; return; }

  const me = await api.me();
  authView.hidden = true; appView.hidden = false;
  if (me.unlinked) {
    $('#hello').textContent = 'Welcome';
    $('#tabs').hidden = true;
    view.innerHTML = `<section class="pcard"><h2>Almost there</h2><p>You’re signed in as <strong>${esc(me.email)}</strong>, but this email isn’t linked to a family in the parish register yet.</p><p>Please contact the church secretary at <a href="mailto:secretary@mtcatlanta.org">secretary@mtcatlanta.org</a> and we’ll connect your account.</p></section>`;
    return;
  }
  ctx.meId = me.id;
  $('#tabs').hidden = false;
  $('#hello').textContent = `Welcome, ${me.first_name}`;
  $('[data-officer]').hidden = !['officer', 'admin'].includes(me.role);
  const start = location.hash.slice(1);
  show(VIEWS[start] && (start !== 'officer' || !$('[data-officer]').hidden) ? start : 'overview');
}

(async function init() {
  try {
    api = DEMO ? demoApi() : await supabaseApi();
  } catch (err) {
    loading.textContent = 'The member portal could not load. Please check your connection and refresh.';
    return;
  }
  $$('[data-demo]').forEach((el) => (el.hidden = !api.demo));
  api.onAuth((event) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; route(); }
    if (event === 'SIGNED_OUT') { recovering = false; }
  });
  // Supabase puts the recovery token in the URL hash
  if (/type=recovery/.test(location.hash)) recovering = true;
  await route();
})();
