// Mar Thoma Church, Atlanta — member portal
import {
  getClient, ok, $, $$, esc, val, money, date, dateTime, todayIso, friendly, msg, busy, toast,
  dialog, confirmDialog, getSettings, prepareImage, download, icsFor, mediaUrl, linkify
} from './common.js';

const PORTAL_URL = location.origin + location.pathname;
const ORGS = (window.MTCA && window.MTCA.orgs) || [];

let sb = null;
let me = null;
let settings = null;
const cache = {};

/* ---------------------------------------------------------------------
   Data
--------------------------------------------------------------------- */
const api = {
  async me() {
    if (me) return me;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const row = ok(await sb.from('members').select('*, family:families(*)').eq('auth_user_id', user.id).maybeSingle());
    me = row || { unlinked: true, email: user.email };
    return me;
  },
  familyMembers: async () => ok(await sb.from('members').select('*').eq('family_id', me.family_id).order('date_of_birth', { ascending: true, nullsFirst: false })),
  contributions: async () => ok(await sb.from('contributions').select('*').eq('family_id', me.family_id).order('given_on', { ascending: false })),
  pledges: async () => ok(await sb.from('pledges').select('*').eq('family_id', me.family_id)),
  onlinePayments: async () => ok(await sb.from('zeffy_payments').select('id, paid_at, received_at, amount, campaign, kind, status, contribution_id').eq('family_id', me.family_id).order('paid_at', { ascending: false }).limit(12)),
  orgMemberships: async () => ok(await sb.from('organization_memberships').select('*')),
  announcements: async () => ok(await sb.from('member_announcements').select('*').lte('published_on', todayIso())
    .order('pinned', { ascending: false }).order('published_on', { ascending: false }).limit(40)).filter((a) => !a.expires_on || a.expires_on >= todayIso()).slice(0, 20),
  events: async () => ok(await sb.from('events').select('*').gte('starts_at', new Date(Date.now() - 6 * 3600e3).toISOString()).order('starts_at').limit(5)),
  documents: async () => ok(await sb.from('member_documents').select('*').order('published_on', { ascending: false })),
  directory: async () => ok(await sb.rpc('member_directory')),
  myPhotos: async () => ok(await sb.from('photo_submissions').select('*').eq('member_id', me.id).order('created_at', { ascending: false })),
  updateFamily: async (p) => { ok(await sb.rpc('update_my_family', { p_address_line1: p.address_line1, p_address_line2: p.address_line2, p_city: p.city, p_state: p.state, p_zip: p.zip, p_home_phone: p.home_phone })); me = null; },
  updateMember: async (id, p) => { ok(await sb.rpc('update_family_member', { p_member_id: id, p_mobile_phone: p.mobile_phone, p_email: p.email, p_date_of_birth: p.date_of_birth || null, p_directory_opt_in: !!p.directory_opt_in })); me = null; }
};

async function signedUrls(bucket, paths, seconds = 3600) {
  if (!paths.length) return {};
  const rows = ok(await sb.storage.from(bucket).createSignedUrls(paths, seconds));
  return Object.fromEntries(rows.filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]));
}

/* ---------------------------------------------------------------------
   Sign-in screens
--------------------------------------------------------------------- */
const authView = $('#auth-view');
const appView = $('#app-view');
const loading = $('#loading');
const loginForm = $('#login-form');
const resetForm = $('#reset-form');
let recovering = /type=recovery/.test(location.hash);

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginForm.email.value.trim();
  const password = loginForm.password.value.trim();
  if (!email) return msg(loginForm, 'Please enter your email.', true);
  if (!password) return msg(loginForm, 'Enter your password, or use “Email me a sign-in link”.', true);
  busy(loginForm, true); msg(loginForm, 'Signing in…');
  try { ok(await sb.auth.signInWithPassword({ email, password })); msg(loginForm, ''); me = null; await route(); }
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
    if (action === 'magic') {
      ok(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: PORTAL_URL } }));
      msg(loginForm, 'Check your email for a sign-in link.');
    } else {
      ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: PORTAL_URL }));
      msg(loginForm, 'If that email is registered, a reset link is on its way.');
    }
  } catch (err) { msg(loginForm, friendly(err), true); }
  finally { busy(loginForm, false); }
});

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = resetForm.password.value, c = resetForm.confirm.value;
  if (p.length < 8) return msg(resetForm, 'Use at least 8 characters.', true);
  if (p !== c) return msg(resetForm, 'The passwords don’t match.', true);
  busy(resetForm, true);
  try { ok(await sb.auth.updateUser({ password: p })); recovering = false; history.replaceState(null, '', PORTAL_URL); await route(); }
  catch (err) { msg(resetForm, friendly(err), true); }
  finally { busy(resetForm, false); }
});

$('#sign-out').addEventListener('click', async () => { me = null; await sb.auth.signOut(); await route(); });

/* ---------------------------------------------------------------------
   Views
--------------------------------------------------------------------- */
const view = $('#view');
let current = 'overview';
const ctx = {};

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) show(b.dataset.tab);
});

async function show(tab) {
  current = tab;
  $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  view.innerHTML = '<p class="muted">Loading…</p>';
  try { view.innerHTML = await VIEWS[tab](); BIND[tab] && (await BIND[tab]()); }
  catch (err) { view.innerHTML = `<div class="notice notice--error">Something went wrong loading this page. ${esc(friendly(err))}</div>`; }
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
}

const age = (dob) => { if (!dob) return ''; const d = new Date(dob + 'T12:00:00'), t = new Date(); let a = t.getFullYear() - d.getFullYear(); if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const field = (label, v) => `<div class="kv"><dt>${label}</dt><dd>${val(v)}</dd></div>`;
const yesno = (b) => b === true ? 'Yes' : b === false ? 'No' : '';
const tabOn = (t) => settings.member_tabs[t] !== false;

const VIEWS = {
  async overview() {
    const [contribs, pledges, anns, events] = await Promise.all([
      tabOn('giving') ? api.contributions() : [], tabOn('giving') ? api.pledges() : [], api.announcements(), api.events()]);
    const y = new Date().getFullYear();
    const ytd = contribs.filter((c) => c.given_on.startsWith(String(y))).reduce((s, c) => s + Number(c.amount), 0);
    const pledge = pledges.filter((p) => p.year === y).reduce((s, p) => s + Number(p.amount), 0);
    const subs = contribs.filter((c) => c.given_on.startsWith(String(y)) && c.category === 'Subscription').reduce((s, c) => s + Number(c.amount), 0);
    const last = contribs[0];
    const pct = pledge ? Math.min(100, Math.round((subs / pledge) * 100)) : 0;
    const f = me.family;
    ctx.events = events;
    const quick = [
      tabOn('profile') && ['profile', 'Review my contact details'],
      tabOn('family') && ['family', 'Update family members'],
      tabOn('giving') && ['giving', `Print my ${y} giving statement`],
      tabOn('photos') && settings.photo_uploads.enabled && ['photos', 'Share photos with the parish'],
      tabOn('documents') && ['documents', 'Members-only documents']
    ].filter(Boolean);
    return `
      <div class="stats">
        ${tabOn('giving') ? `
        <div class="stat"><span>${y} giving to date</span><strong>${money(ytd)}</strong></div>
        <div class="stat"><span>Subscription pledge</span><strong>${pledge ? money(pledge) : '—'}</strong>
          ${pledge ? `<div class="meter" role="img" aria-label="${pct}% of pledge"><i style="width:${pct}%"></i></div><small>${money(subs)} paid · ${pct}%</small>` : ''}</div>
        <div class="stat"><span>Last contribution</span><strong>${last ? money(last.amount) : '—'}</strong><small>${last ? date(last.given_on) + ' · ' + esc(last.category) : ''}</small></div>` : ''}
        <div class="stat"><span>Member number</span><strong>${val(f.member_number)}</strong><small>${val(f.prayer_group)}</small></div>
      </div>
      <div class="grid-2">
        <section class="pcard">
          <h2>Announcements</h2>
          ${anns.length ? anns.map((a) => `<article class="ann${a.flyer_url ? ' ann--flyer' : ''}">${a.flyer_url ? `<a class="ann__flyer" href="${esc(mediaUrl(a.flyer_url))}" target="_blank" rel="noopener"><img src="${esc(mediaUrl(a.flyer_url))}" alt="Flyer: ${esc(a.title)}" loading="lazy"></a>` : ''}${a.pinned ? '<span class="badge">Pinned</span>' : ''}<p class="ann__date">${date(a.published_on)}</p><h3>${esc(a.title)}</h3><p>${linkify(a.body)}</p>${a.link_url ? `<p><a href="${esc(a.link_url)}" target="_blank" rel="noopener">More details →</a></p>` : ''}</article>`).join('') : '<p class="muted">No announcements right now.</p>'}
        </section>
        <div class="stack">
          <section class="pcard">
            <h2>Coming up</h2>
            ${events.length ? `<ul class="mini-events">${events.map((e, i) => `<li><button class="link-row" data-event="${i}"><span class="mini-events__date"><b>${new Date(e.starts_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short' })}</b>${new Date(e.starts_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', day: 'numeric' })}</span><span><strong>${esc(e.title)}</strong><small>${esc(dateTime(e.starts_at, e.all_day))}${e.location ? ' · ' + esc(e.location) : ''}</small></span></button></li>`).join('')}</ul>` : '<p class="muted">No upcoming events posted.</p>'}
            <a class="text-link" href="../events/">Full calendar →</a>
          </section>
          ${quick.length ? `<section class="pcard"><h2>Quick links</h2><ul class="quick">${quick.map(([t, l]) => `<li><button data-go="${t}">${l}</button></li>`).join('')}</ul></section>` : ''}
        </div>
      </div>`;
  },

  async profile() {
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
    const [contribs, pledges, online] = await Promise.all([api.contributions(), api.pledges(), api.onlinePayments().catch(() => [])]);
    const years = [...new Set(contribs.map((c) => +c.given_on.slice(0, 4)).concat(new Date().getFullYear()))].sort((a, b) => b - a);
    ctx.giving = { contribs, pledges };
    return `
      ${giveOnlineHtml(online)}
      <div class="pcard__head no-print">
        <label class="inline">Year <select id="giving-year">${years.map((y) => `<option>${y}</option>`).join('')}</select></label>
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
    ctx.directory = await api.directory();
    return `
      <section class="pcard">
        <div class="pcard__head"><h2>Parish directory</h2><input type="search" id="dir-q" placeholder="Search name or area" aria-label="Search directory"></div>
        <p class="muted small">Only members who choose “List me in the directory” appear here. You can change yours under My Profile.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Family</th><th>Mobile</th><th>Email</th><th>Prayer group</th></tr></thead><tbody id="dir-rows"></tbody></table></div>
      </section>`;
  },

  async documents() {
    const docs = await api.documents();
    ctx.docs = docs;
    const cats = [...new Set(docs.map((d) => d.category || 'General'))];
    return cats.length ? cats.map((c) => `
      <section class="pcard">
        <h2>${esc(c)}</h2>
        <ul class="doc-list">${docs.map((d, i) => [d, i]).filter(([d]) => (d.category || 'General') === c).map(([d, i]) => `<li><a href="${d.url.startsWith('storage:') ? '#' : esc(d.url)}" data-doc="${i}" target="_blank" rel="noopener"><span class="doc-icon">${/\.pdf($|\?)/i.test(d.url) ? 'PDF' : 'DOC'}</span><span>${esc(d.title)} <small class="muted">· ${date(d.published_on)}</small></span></a></li>`).join('')}</ul>
      </section>`).join('') : '<section class="pcard"><p class="muted">No documents have been posted yet.</p></section>';
  },

  async photos() {
    const p = settings.photo_uploads;
    const mine = await api.myPhotos();
    ctx.photos = mine;
    return `
      <div class="grid-2 grid-2--wide-left">
        <section class="pcard">
          <h2>Share photos</h2>
          ${p.enabled ? `
          <p class="muted small">${esc(p.note || 'Photos are reviewed by the church office before they appear in the gallery.')}</p>
          <form id="photo-form" class="form form--flat">
            <label class="drop" id="drop">
              <input type="file" name="files" accept="image/jpeg,image/png,image/webp,image/gif" multiple required>
              <span class="drop__text"><strong>Choose photos</strong> or drag them here<br><small>JPEG, PNG or WebP · up to ${Number(p.max_mb) || 10} MB each</small></span>
            </label>
            <div id="photo-previews" class="thumbs"></div>
            <label>Event or occasion <input name="event_name" placeholder="e.g. Christmas carol service" maxlength="120"></label>
            <label>Caption <input name="caption" placeholder="Optional" maxlength="300"></label>
            <label class="check"><input type="checkbox" name="consent" required> I took these photos or have permission to share them, and everyone pictured is happy for them to be shared.</label>
            <button class="btn btn--primary" type="submit">Submit photos</button>
            <div class="progress" hidden><i></i></div>
            <p class="form__msg" role="status"></p>
          </form>` : '<p class="muted">Photo sharing is turned off right now.</p>'}
        </section>
        <section class="pcard">
          <h2>My submissions</h2>
          ${mine.length ? `<div class="photo-grid">${mine.map((s) => `
            <figure class="photo" data-path="${esc(s.storage_path)}">
              <div class="photo__img"></div>
              <figcaption><span class="status status--${s.status}">${s.status === 'pending' ? 'Waiting for review' : s.status === 'approved' ? 'Approved' : 'Not approved'}</span>
                ${s.event_name ? `<small>${esc(s.event_name)}</small>` : ''}
                ${s.status === 'pending' ? `<button class="link-btn small" data-delete-photo="${esc(s.id)}">Withdraw</button>` : ''}</figcaption>
            </figure>`).join('')}</div>` : '<p class="muted">You haven’t shared any photos yet.</p>'}
        </section>
      </div>`;
  },

  async account() {
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
  }
};

/* Online giving through Zeffy — form links come from Admin → Portal Settings → Online giving. */
const ZEFFY_KINDS = {
  monthly: { title: 'Monthly subscription', blurb: 'Set up your parish subscription as a monthly charge. Zeffy charges your card automatically each month.', btn: 'Set up monthly subscription', key: 'monthly_url', note: 'monthly_note' },
  donation: { title: 'One-time donation', blurb: 'Give a gift to the church today, of any amount.', btn: 'Give a donation', key: 'donate_url' },
  other: { title: 'Pay for something else', blurb: 'Events, special offerings and other payments.', btn: 'Make a payment', key: 'other_url', note: 'other_note' }
};
function giveOnlineHtml(online) {
  const z = settings.zeffy || {};
  const opts = Object.entries(ZEFFY_KINDS).filter(([, k]) => z[k.key]);
  const kindLabel = (k) => (ZEFFY_KINDS[k] || ZEFFY_KINDS.donation).title;
  return `<section class="pcard no-print give-online">
    <div class="pcard__head"><div><h2>Give online</h2>
      <p class="muted small">Secure payments through Zeffy — the church receives 100% of what you give. Use <strong>${esc(me.email)}</strong> on the form so the payment is linked to your family.</p></div></div>
    ${opts.length ? `<div class="give-opts">${opts.map(([kind, k]) => `
      <div class="give-opt give-opt--${kind}">
        <h3>${k.title}</h3>
        <p class="small">${esc((k.note && z[k.note]) || k.blurb)}</p>
        <button class="btn ${kind === 'monthly' ? 'btn--primary' : 'btn--outline'} btn--small" data-give="${kind}">${k.btn}</button>
      </div>`).join('')}</div>` : '<p class="muted">Online giving will be available here soon. Until then, please give by check.</p>'}
    ${online.length ? `<h3 class="give-online__h">Your recent online payments</h3>
      <div class="table-wrap"><table class="table table--compact"><tbody>${online.map((o) => `<tr>
        <td class="nowrap">${date((o.paid_at || o.received_at).slice(0, 10))}</td>
        <td>${esc(o.campaign || kindLabel(o.kind))}${o.kind === 'monthly' ? ' <span class="pill">Monthly</span>' : ''}</td>
        <td class="small muted">${o.status !== 'succeeded' ? esc(o.status) : o.contribution_id ? 'On your statement' : 'Received — added to your statement once posted'}</td>
        <td class="num">${money(o.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </section>`;
}
function openGiving(kind) {
  const z = settings.zeffy || {}, k = ZEFFY_KINDS[kind], link = z[k.key];
  if (!link) return;
  const d = dialog(esc(k.title), `
    <iframe class="give-frame" title="${esc(k.title)} form" src="${esc(window.MTCA_ZEFFY_EMBED(link))}" allow="payment"></iframe>
    <p class="muted small">Please use <strong>${esc(me.email)}</strong> as your email so this payment shows on your family’s giving. Form not loading? <a href="${esc(link)}" target="_blank" rel="noopener">Open it in a new tab</a>.</p>`, null, { wide: true });
  $('button[value=cancel]', d).textContent = 'Close';
  d.addEventListener('close', () => { if (current === 'giving') setTimeout(() => show('giving'), 1500); });
}

function renderStatement(year) {
  const { contribs, pledges } = ctx.giving;
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

async function editMember(id) {
  const members = await api.familyMembers();
  const m = members.find((x) => x.id === id);
  const hasLogin = !!m.auth_user_id;
  dialog(`Edit ${esc(m.first_name)}`, `
    <label>Mobile phone<input name="mobile_phone" type="tel" value="${esc(m.mobile_phone)}"></label>
    <label>Email<input name="email" type="email" value="${esc(m.email)}" ${hasLogin ? 'disabled' : ''}>${hasLogin ? '<small class="muted">This is a login email — contact the secretary to change it.</small>' : ''}</label>
    <label>Date of birth<input name="date_of_birth" type="date" value="${esc(m.date_of_birth)}"></label>
    <label class="check"><input type="checkbox" name="directory_opt_in" ${m.directory_opt_in ? 'checked' : ''}> List ${m.id === me.id ? 'me' : 'them'} in the parish directory</label>`,
    async (p) => { await api.updateMember(id, { ...p, email: hasLogin ? m.email : p.email }); await api.me(); await show(current); toast('Saved'); });
}

function editFamily() {
  const f = me.family;
  dialog('Edit household', `
    <label>Address line 1<input name="address_line1" value="${esc(f.address_line1)}" autocomplete="address-line1"></label>
    <label>Address line 2<input name="address_line2" value="${esc(f.address_line2)}" autocomplete="address-line2"></label>
    <div class="row-3">
      <label>City<input name="city" value="${esc(f.city)}" autocomplete="address-level2"></label>
      <label>State<input name="state" value="${esc(f.state)}" maxlength="2" autocomplete="address-level1"></label>
      <label>ZIP<input name="zip" value="${esc(f.zip)}" autocomplete="postal-code"></label>
    </div>
    <label>Home phone<input name="home_phone" type="tel" value="${esc(f.home_phone)}"></label>`,
    async (p) => { await api.updateFamily(p); await api.me(); await show(current); toast('Saved'); });
}

function showEvent(e) {
  const d = dialog(esc(e.title), `
    <p class="event-when">${esc(dateTime(e.starts_at, e.all_day))}${e.ends_at && !e.all_day ? ' – ' + esc(new Date(e.ends_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })) : ''}</p>
    ${e.location ? `<p><strong>Where:</strong> ${esc(e.location)}</p>` : ''}
    ${e.description ? `<p class="pre">${esc(e.description)}</p>` : ''}
    <p><button type="button" class="btn btn--outline btn--small" data-ics>Add to my calendar</button></p>`, null);
  $('[data-ics]', d).onclick = () => download(`${e.title.replace(/[^\w]+/g, '-')}.ics`, icsFor(e), 'text/calendar');
}

const BIND = {
  overview() {
    $$('[data-go]', view).forEach((b) => (b.onclick = () => show(b.dataset.go)));
    $$('[data-event]', view).forEach((b) => (b.onclick = () => showEvent(ctx.events[+b.dataset.event])));
  },
  profile() {
    $$('[data-edit-member]', view).forEach((b) => (b.onclick = () => editMember(b.dataset.editMember)));
    $('#edit-family').onclick = editFamily;
  },
  family() { $$('[data-edit-member]', view).forEach((b) => (b.onclick = () => editMember(b.dataset.editMember))); },
  giving() {
    const s = $('#giving-year'); s.onchange = () => renderStatement(s.value); renderStatement(s.value);
    $$('[data-give]', view).forEach((b) => (b.onclick = () => openGiving(b.dataset.give)));
  },
  directory() {
    const draw = (q = '') => {
      const t = q.toLowerCase();
      const rows = ctx.directory.filter((r) => !t || Object.values(r).join(' ').toLowerCase().includes(t));
      $('#dir-rows').innerHTML = rows.map((r) => `<tr><td><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong></td><td>${val(r.family_name)}</td><td>${r.mobile_phone ? `<a href="tel:${esc(r.mobile_phone)}">${esc(r.mobile_phone)}</a>` : val('')}</td><td>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : val('')}</td><td>${val(r.prayer_group)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No matches.</td></tr>';
    };
    draw();
    $('#dir-q').oninput = (e) => draw(e.target.value);
  },
  documents() {
    $$('[data-doc]', view).forEach((a) => {
      const d = ctx.docs[+a.dataset.doc];
      if (!d.url.startsWith('storage:')) return;
      a.onclick = async (e) => {
        e.preventDefault();
        const win = window.open('', '_blank');
        try {
          const { signedUrl } = ok(await sb.storage.from('member-documents').createSignedUrl(d.url.slice(8), 600));
          if (win) win.location = signedUrl; else location.href = signedUrl;
        } catch (err) { if (win) win.close(); toast(friendly(err), true); }
      };
    });
  },
  async photos() {
    // thumbnails of my submissions
    const figs = $$('[data-path]', view);
    if (figs.length) {
      const urls = await signedUrls('member-photos', figs.map((f) => f.dataset.path)).catch(() => ({}));
      figs.forEach((f) => { const u = urls[f.dataset.path]; if (u) $('.photo__img', f).style.backgroundImage = `url("${u}")`; });
    }
    $$('[data-delete-photo]', view).forEach((b) => (b.onclick = () => {
      const s = ctx.photos.find((x) => x.id === b.dataset.deletePhoto);
      confirmDialog('Withdraw this photo?', 'It will be removed before anyone reviews it.', async () => {
        ok(await sb.from('photo_submissions').delete().eq('id', s.id));
        await sb.storage.from('member-photos').remove([s.storage_path]);
        await show('photos'); toast('Photo withdrawn');
      }, 'Withdraw');
    }));

    const form = $('#photo-form');
    if (!form) return;
    const input = form.files;
    const maxBytes = (Number(settings.photo_uploads.max_mb) || 10) * 1048576;
    const previews = $('#photo-previews');
    const drop = $('#drop');
    const renderPreviews = () => {
      previews.innerHTML = [...input.files].map((f) => `<span class="thumb${f.size > maxBytes * 3 ? ' thumb--bad' : ''}" style="background-image:url('${URL.createObjectURL(f)}')" title="${esc(f.name)}"></span>`).join('');
    };
    input.onchange = renderPreviews;
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; renderPreviews(); } });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const files = [...input.files];
      if (!files.length) return msg(form, 'Choose at least one photo.', true);
      if (files.length > 20) return msg(form, 'Please share up to 20 photos at a time.', true);
      if (!form.consent.checked) return msg(form, 'Please confirm you have permission to share these photos.', true);
      busy(form, true);
      const bar = $('.progress', form); bar.hidden = false;
      let done = 0, failed = 0;
      for (const original of files) {
        msg(form, `Uploading ${done + failed + 1} of ${files.length}…`);
        try {
          const file = await prepareImage(original);
          if (file.size > maxBytes) throw new Error(`${original.name} is larger than ${settings.photo_uploads.max_mb} MB`);
          const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          ok(await sb.storage.from('member-photos').upload(path, file, { contentType: file.type, upsert: false }));
          const ins = await sb.from('photo_submissions').insert({ member_id: me.id, storage_path: path, caption: form.caption.value.trim() || null, event_name: form.event_name.value.trim() || null });
          if (ins.error) { await sb.storage.from('member-photos').remove([path]); throw ins.error; }
          done++;
        } catch (err) { failed++; console.warn(err); toast(friendly(err), true); }
        $('i', bar).style.width = `${Math.round(((done + failed) / files.length) * 100)}%`;
      }
      busy(form, false);
      if (done) { toast(`${done} photo${done > 1 ? 's' : ''} sent for review. Thank you!`); await show('photos'); }
      if (failed) msg($('#photo-form') || form, `${failed} photo${failed > 1 ? 's' : ''} couldn’t be uploaded.`, true);
    };
  },
  account() {
    const f = $('#pw-form');
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.password.value.length < 8) return msg(f, 'Use at least 8 characters.', true);
      if (f.password.value !== f.confirm.value) return msg(f, 'The passwords don’t match.', true);
      busy(f, true);
      try { ok(await sb.auth.updateUser({ password: f.password.value })); f.reset(); msg(f, 'Password updated.'); }
      catch (err) { msg(f, friendly(err), true); }
      finally { busy(f, false); }
    };
  }
};

/* ---------------------------------------------------------------------
   Routing
--------------------------------------------------------------------- */
async function route() {
  loading.hidden = true;
  if (recovering) { authView.hidden = false; appView.hidden = true; loginForm.hidden = true; resetForm.hidden = false; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { authView.hidden = false; appView.hidden = true; loginForm.hidden = false; resetForm.hidden = true; return; }

  me = null;
  const m = await api.me();
  authView.hidden = true; appView.hidden = false;
  if (!m || m.unlinked) {
    $('#hello').textContent = 'Welcome';
    $('#tabs').hidden = true;
    $('#admin-link').hidden = true;
    view.innerHTML = `<section class="pcard"><h2>Almost there</h2><p>You’re signed in as <strong>${esc(m ? m.email : '')}</strong>, but this email isn’t linked to a family in the parish register yet.</p><p>Please contact the church secretary at <a href="mailto:secretary@mtcatlanta.org">secretary@mtcatlanta.org</a> and we’ll connect your account.</p></section>`;
    return;
  }
  settings = await getSettings(sb);
  $$('#tabs [data-tab]').forEach((b) => (b.hidden = !tabOn(b.dataset.tab) && b.dataset.tab !== 'overview' && b.dataset.tab !== 'account'));
  $('#tabs').hidden = false;
  $('#hello').textContent = `Welcome, ${me.first_name}`;
  $('#admin-link').hidden = !['officer', 'admin'].includes(me.role);
  const start = location.hash.slice(1);
  const visible = (t) => VIEWS[t] && !$(`#tabs [data-tab="${t}"]`).hidden;
  show(visible(start) ? start : 'overview');
}

(async function init() {
  try { sb = await getClient(); } catch (e) { sb = null; }
  if (!sb) { loading.textContent = 'The member portal could not load. Please check your connection and refresh.'; return; }
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; route(); }
  });
  await route();
})();
