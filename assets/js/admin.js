// Mar Thoma Church, Atlanta — parish admin
import {
  getClient, ok, $, $$, esc, val, money, date, dateTime, todayIso, friendly, msg, busy, toast,
  dialog, confirmDialog, getSettings, csv, download, localToIso, isoToLocal
} from './common.js';

const ORGS = (window.MTCA && window.MTCA.orgs) || [];
const PORTAL_URL = new URL('../members/', location.href).href;
const RELATIONSHIPS = ['Head', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Grandparent', 'Sibling', 'Other'];
const GIVING_CATEGORIES = ['Subscription', 'Sunday Offering', 'Thanksgiving', 'Mission', 'Building Fund', 'Harvest Festival', 'Other'];
const METHODS = ['Check', 'Zelle', 'Cash', 'Online'];
const EVENT_CATEGORIES = ['Worship', 'Parish', 'Youth', 'Sunday School', 'Sevika Sangham', 'Fellowship', 'Special'];
const DOC_CATEGORIES = ['General', 'Minutes', 'Annual Report', 'Forms', 'Budget', 'Policies'];
const MEMBER_TABS = [['overview', 'Overview'], ['profile', 'My Profile'], ['family', 'Family'], ['giving', 'Giving'], ['organizations', 'Organizations'], ['directory', 'Directory'], ['documents', 'Documents'], ['photos', 'Share Photos'], ['account', 'Account']];

let sb = null;
let me = null;
const isAdmin = () => me && me.role === 'admin';

/* ---------------------------------------------------------------------
   Sign-in
--------------------------------------------------------------------- */
const authView = $('#auth-view');
const appView = $('#app-view');
const loading = $('#loading');
const loginForm = $('#login-form');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginForm.email.value.trim(), password = loginForm.password.value;
  if (!email || !password) return msg(loginForm, 'Enter your email and password.', true);
  busy(loginForm, true); msg(loginForm, 'Signing in…');
  try { ok(await sb.auth.signInWithPassword({ email, password })); msg(loginForm, ''); await route(); }
  catch (err) { msg(loginForm, friendly(err), true); }
  finally { busy(loginForm, false); }
});
$('#sign-out').addEventListener('click', async () => { await sb.auth.signOut(); await route(); });

/* ---------------------------------------------------------------------
   Form fields
--------------------------------------------------------------------- */
function input(f, v) {
  const req = f.required ? 'required' : '';
  const dis = f.disabled ? 'disabled' : '';
  const name = `name="${f.name}"`;
  const hint = f.hint ? `<small class="muted">${f.hint}</small>` : '';
  const value = v ?? f.default ?? '';
  switch (f.type) {
    case 'checkbox': return `<label class="check"><input type="checkbox" ${name} ${(v ?? f.default) ? 'checked' : ''} ${dis}> ${f.label}</label>`;
    case 'textarea': return `<label>${f.label}<textarea ${name} rows="${f.rows || 5}" ${req} ${dis}>${esc(value)}</textarea>${hint}</label>`;
    case 'select': return `<label>${f.label}<select ${name} ${req} ${dis}>${f.blank ? `<option value="">${f.blank}</option>` : ''}${f.options.map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(value) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>${hint}</label>`;
    case 'datetime': return `<label>${f.label}<input type="datetime-local" ${name} value="${esc(isoToLocal(v))}" ${req} ${dis}>${hint}</label>`;
    default: return `<label>${f.label}<input type="${f.type || 'text'}" ${name} value="${esc(value)}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${req} ${dis}>${hint}</label>`;
  }
}
const formHtml = (fields, row = {}) => fields.map((f) => f.row ? `<div class="row-${f.row.length}">${f.row.map((g) => input(g, row[g.name])).join('')}</div>` : input(f, row[f.name])).join('');
const flatFields = (fields) => fields.flatMap((f) => f.row || [f]);
function readValues(fields, values) {
  const out = {};
  flatFields(fields).forEach((f) => {
    if (f.disabled || f.virtual) return;
    let v = values[f.name];
    if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'datetime') v = v ? localToIso(v) : null;
    else if (f.type === 'number') v = v === '' || v === undefined ? null : Number(v);
    else v = typeof v === 'string' ? (v.trim() || null) : v ?? null;
    out[f.name] = v;
  });
  return out;
}

/* ---------------------------------------------------------------------
   Generic list editor (announcements, events, documents)
--------------------------------------------------------------------- */
function crud(cfg) {
  const state = { filter: cfg.filters ? cfg.filters[0][0] : null, rows: [] };
  async function load() {
    let q = sb.from(cfg.table).select(cfg.select || '*');
    (cfg.order || []).forEach(([col, asc]) => (q = q.order(col, { ascending: asc })));
    state.rows = ok(await q);
  }
  const visible = () => cfg.filters ? state.rows.filter((r) => cfg.filters.find((f) => f[0] === state.filter)[2](r)) : state.rows;
  function edit(row) {
    const isNew = !row;
    dialog(`${isNew ? 'Add' : 'Edit'} ${cfg.noun}`, formHtml(cfg.fields(row), row || {}), async (values, form) => {
      let data = readValues(cfg.fields(row), values);
      if (cfg.beforeSave) data = await cfg.beforeSave(data, form, row);
      if (isNew) ok(await sb.from(cfg.table).insert(data));
      else ok(await sb.from(cfg.table).update(data).eq('id', row.id));
      toast(`${cfg.noun[0].toUpperCase() + cfg.noun.slice(1)} saved`);
      await show(cfg.key);
    }, { wide: true });
  }
  return {
    async view() {
      await load();
      const rows = visible();
      return `
        <section class="pcard">
          <div class="pcard__head"><div><h2>${cfg.title}</h2>${cfg.intro ? `<p class="muted small">${cfg.intro}</p>` : ''}</div>
            <button class="btn btn--primary btn--small" data-add>+ Add ${cfg.noun}</button></div>
          ${cfg.filters ? `<div class="seg" role="tablist">${cfg.filters.map(([k, l, fn]) => `<button data-filter="${k}" aria-selected="${k === state.filter}">${l} <span class="muted">${state.rows.filter(fn).length}</span></button>`).join('')}</div>` : ''}
          ${rows.length ? `<div class="table-wrap"><table class="table">
            <thead><tr>${cfg.columns.map((c) => `<th class="${c.cls || ''}">${c.label}</th>`).join('')}<th></th></tr></thead>
            <tbody>${rows.map((r) => `<tr>${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}
              <td class="row-actions"><button class="link-btn" data-edit="${r.id}">Edit</button><button class="link-btn link-btn--danger" data-del="${r.id}">Delete</button></td></tr>`).join('')}</tbody>
          </table></div>` : `<p class="empty">${cfg.empty}</p>`}
        </section>`;
    },
    bind() {
      $('[data-add]', view).onclick = () => edit(null);
      $$('[data-filter]', view).forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; show(cfg.key); }));
      $$('[data-edit]', view).forEach((b) => (b.onclick = () => edit(state.rows.find((r) => r.id === b.dataset.edit))));
      $$('[data-del]', view).forEach((b) => (b.onclick = () => {
        const row = state.rows.find((r) => r.id === b.dataset.del);
        confirmDialog(`Delete this ${cfg.noun}?`, `“${esc(row.title)}” will be removed. This can’t be undone.`, async () => {
          if (cfg.onDelete) await cfg.onDelete(row);
          ok(await sb.from(cfg.table).delete().eq('id', row.id));
          toast('Deleted'); await show(cfg.key);
        });
      }));
    }
  };
}

const AUDIENCE = { members: 'Members only', public: 'Home page only', both: 'Home page + members' };
const announcements = crud({
  key: 'announcements', table: 'member_announcements', noun: 'announcement', title: 'Announcements',
  intro: 'Choose where each one appears: the public home page, the member portal, or both.',
  order: [['pinned', false], ['published_on', false]],
  empty: 'No announcements yet. Add one to show it on the home page or in the member portal.',
  filters: [['current', 'Current', (r) => !r.expires_on || r.expires_on >= todayIso()], ['expired', 'Expired', (r) => r.expires_on && r.expires_on < todayIso()], ['all', 'All', () => true]],
  fields: () => [
    { name: 'title', label: 'Title', required: true, maxlength: 140 },
    { name: 'body', label: 'Message', type: 'textarea', required: true, rows: 5 },
    { name: 'audience', label: 'Show on', type: 'select', options: Object.entries(AUDIENCE), default: 'both' },
    { row: [{ name: 'published_on', label: 'Show from', type: 'date', default: todayIso(), required: true }, { name: 'expires_on', label: 'Hide after (optional)', type: 'date' }] },
    { name: 'link_url', label: 'Link for “More details” (optional)', type: 'url', placeholder: 'https://' },
    { name: 'pinned', label: 'Pin to the top', type: 'checkbox' }
  ],
  columns: [
    { label: 'Title', render: (r) => `<strong>${esc(r.title)}</strong>${r.pinned ? ' <span class="badge">Pinned</span>' : ''}<br><small class="muted clamp">${esc(r.body)}</small>` },
    { label: 'Shows on', render: (r) => `<span class="pill pill--${r.audience}">${AUDIENCE[r.audience] || r.audience}</span>` },
    { label: 'From', render: (r) => date(r.published_on) },
    { label: 'Until', render: (r) => r.expires_on ? date(r.expires_on) : '<span class="muted">—</span>' }
  ]
});

const events = crud({
  key: 'events', table: 'events', noun: 'event', title: 'Events calendar',
  intro: 'Published events appear on the public Events page and the member portal. Members-only events are hidden from the public.',
  order: [['starts_at', true]],
  empty: 'No events yet. Add services, meetings and special days to fill the calendar.',
  filters: [['upcoming', 'Upcoming', (r) => new Date(r.ends_at || r.starts_at) >= new Date(Date.now() - 864e5)], ['past', 'Past', (r) => new Date(r.ends_at || r.starts_at) < new Date(Date.now() - 864e5)], ['drafts', 'Drafts', (r) => !r.published]],
  fields: () => [
    { name: 'title', label: 'Event name', required: true, maxlength: 140 },
    { row: [{ name: 'starts_at', label: 'Starts', type: 'datetime', required: true }, { name: 'ends_at', label: 'Ends (optional)', type: 'datetime' }] },
    { name: 'all_day', label: 'All-day event', type: 'checkbox' },
    { row: [{ name: 'location', label: 'Location', placeholder: 'Church hall' }, { name: 'category', label: 'Category', type: 'select', options: EVENT_CATEGORIES, default: 'Parish' }] },
    { name: 'description', label: 'Details', type: 'textarea', rows: 4 },
    { name: 'published', label: 'Published (visible on the calendar)', type: 'checkbox', default: true },
    { name: 'members_only', label: 'Members only (hide from the public calendar)', type: 'checkbox' }
  ],
  beforeSave: (d) => { if (d.ends_at && new Date(d.ends_at) < new Date(d.starts_at)) throw new Error('The end time is before the start time.'); return d; },
  columns: [
    { label: 'When', render: (r) => `<span class="nowrap">${esc(dateTime(r.starts_at, r.all_day))}</span>` },
    { label: 'Event', render: (r) => `<strong>${esc(r.title)}</strong>${r.location ? `<br><small class="muted">${esc(r.location)}</small>` : ''}` },
    { label: 'Category', render: (r) => esc(r.category) },
    { label: 'Visibility', render: (r) => !r.published ? '<span class="pill">Draft</span>' : r.members_only ? '<span class="pill pill--members">Members only</span>' : '<span class="pill pill--both">Public</span>' }
  ]
});

const documents = crud({
  key: 'documents', table: 'member_documents', noun: 'document', title: 'Members-only documents',
  intro: 'Upload a file or link to one (for example a Google Drive link). Only signed-in members can open uploaded files.',
  order: [['published_on', false]],
  empty: 'No documents yet. Minutes, annual reports and forms you add here appear in the member portal.',
  fields: (row) => [
    { name: 'title', label: 'Title', required: true, maxlength: 160 },
    { row: [{ name: 'category', label: 'Category', type: 'select', options: DOC_CATEGORIES, default: 'General' }, { name: 'published_on', label: 'Date', type: 'date', default: todayIso(), required: true }] },
    { name: 'file', label: row && row.url && row.url.startsWith('storage:') ? 'Replace file (optional)' : 'Upload a file', type: 'file', virtual: true },
    { name: 'url', label: 'Or a link', type: 'url', placeholder: 'https://', disabled: !!(row && row.url && row.url.startsWith('storage:')), hint: row && row.url && row.url.startsWith('storage:') ? 'This document is an uploaded file.' : '' }
  ],
  async beforeSave(d, form, row) {
    const file = form.file.files[0];
    if (file) {
      if (file.size > 25 * 1048576) throw new Error('Files must be 25 MB or smaller.');
      const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '-')}`;
      ok(await sb.storage.from('member-documents').upload(path, file, { contentType: file.type || 'application/octet-stream' }));
      if (row && row.url && row.url.startsWith('storage:')) await sb.storage.from('member-documents').remove([row.url.slice(8)]);
      d.url = 'storage:' + path;
    } else if (row && row.url && row.url.startsWith('storage:')) {
      delete d.url;
    }
    if (!d.url && !(row && row.url)) throw new Error('Upload a file or enter a link.');
    return d;
  },
  onDelete: async (row) => { if (row.url.startsWith('storage:')) await sb.storage.from('member-documents').remove([row.url.slice(8)]); },
  columns: [
    { label: 'Title', render: (r) => `<strong>${esc(r.title)}</strong>` },
    { label: 'Category', render: (r) => esc(r.category) },
    { label: 'Date', render: (r) => date(r.published_on) },
    { label: 'Source', render: (r) => r.url.startsWith('storage:') ? '<span class="pill">Uploaded file</span>' : `<a href="${esc(r.url)}" target="_blank" rel="noopener">Link ↗</a>` }
  ]
});

/* ---------------------------------------------------------------------
   Views
--------------------------------------------------------------------- */
const view = $('#view');
let current = 'overview';
const ctx = { familyId: null, photoFilter: 'pending', familyQuery: '' };

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) { if (b.dataset.tab === 'members') ctx.familyId = null; show(b.dataset.tab); }
});

async function show(tab) {
  current = tab;
  $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const y = window.scrollY;
  view.innerHTML = '<p class="muted">Loading…</p>';
  try { view.innerHTML = await VIEWS[tab](); BIND[tab] && (await BIND[tab]()); }
  catch (err) { console.error(err); view.innerHTML = `<div class="notice notice--error">Something went wrong. ${esc(friendly(err))}</div>`; }
  window.scrollTo(0, y);
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  refreshPhotoCount();
}

async function refreshPhotoCount() {
  try {
    const { count } = await sb.from('photo_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    const el = $('#photo-count'); el.textContent = count || ''; el.hidden = !count;
  } catch (e) { /* ignore */ }
}

const memberFields = (row = {}) => [
  { row: [{ name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true }] },
  { row: [{ name: 'relationship', label: 'Relationship', type: 'select', options: RELATIONSHIPS, default: 'Head' }, { name: 'date_of_birth', label: 'Date of birth', type: 'date' }] },
  { row: [{ name: 'email', label: 'Email', type: 'email', disabled: !!row.auth_user_id, hint: row.auth_user_id ? 'Login email — remove portal access first to change it.' : 'Needed for portal access.' }, { name: 'mobile_phone', label: 'Mobile', type: 'tel' }] },
  { row: [{ name: 'wedding_date', label: 'Wedding date', type: 'date' }, { name: 'role', label: 'Portal role', type: 'select', options: [['member', 'Member'], ['officer', 'Officer — can use Admin'], ['admin', 'Admin — full control']], default: 'member', disabled: !isAdmin(), hint: isAdmin() ? '' : 'Only an admin can change roles.' }] },
  { row: [{ name: 'baptized', label: 'Baptized', type: 'checkbox' }, { name: 'confirmed', label: 'Confirmed', type: 'checkbox' }] },
  { name: 'directory_opt_in', label: 'Listed in the parish directory', type: 'checkbox' }
];
const familyFields = [
  { row: [{ name: 'family_name', label: 'Family name', required: true, placeholder: 'Thomas, Varghese & Mary' }, { name: 'member_number', label: 'Member number' }] },
  { name: 'address_line1', label: 'Address line 1' },
  { name: 'address_line2', label: 'Address line 2' },
  { row: [{ name: 'city', label: 'City' }, { name: 'state', label: 'State', maxlength: 2, default: 'GA' }, { name: 'zip', label: 'ZIP' }] },
  { row: [{ name: 'home_phone', label: 'Home phone', type: 'tel' }, { name: 'prayer_group', label: 'Prayer group / area' }] },
  { row: [{ name: 'home_parish', label: 'Home parish (Kerala)' }, { name: 'member_since', label: 'Member since', type: 'date' }] },
  { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['inactive', 'Inactive'], ['visitor', 'Visitor']], default: 'active' }
];

const VIEWS = {
  async overview() {
    const y = new Date().getFullYear();
    const [fams, mems, pending, evs, contribs] = await Promise.all([
      sb.from('families').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('members').select('id, auth_user_id'),
      sb.from('photo_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('events').select('*').gte('starts_at', new Date().toISOString()).order('starts_at').limit(5),
      sb.from('contributions').select('amount').gte('given_on', `${y}-01-01`).lte('given_on', `${y}-12-31`)
    ]);
    const members = ok(mems), upcoming = ok(evs);
    const total = ok(contribs).reduce((s, c) => s + Number(c.amount), 0);
    return `
      <div class="stats">
        <div class="stat"><span>Active families</span><strong>${fams.count ?? 0}</strong></div>
        <div class="stat"><span>Members</span><strong>${members.length}</strong><small>${members.filter((m) => m.auth_user_id).length} with portal access</small></div>
        <div class="stat"><span>${y} contributions</span><strong>${money(total)}</strong></div>
        <div class="stat"><span>Photos to review</span><strong>${pending.count ?? 0}</strong>${pending.count ? '<small><button class="link-btn" data-go="photos">Review now →</button></small>' : ''}</div>
      </div>
      <div class="grid-2">
        <section class="pcard">
          <div class="pcard__head"><h2>Next events</h2><button class="btn btn--outline btn--small" data-go="events">Manage</button></div>
          ${upcoming.length ? `<ul class="plain-list">${upcoming.map((e) => `<li><strong>${esc(e.title)}</strong><br><small class="muted">${esc(dateTime(e.starts_at, e.all_day))}${e.location ? ' · ' + esc(e.location) : ''}</small></li>`).join('')}</ul>` : '<p class="empty">Nothing on the calendar yet.</p>'}
        </section>
        <section class="pcard">
          <h2>Common tasks</h2>
          <ul class="quick">
            <li><button data-go="members" data-new-family>Add a new family</button></li>
            <li><button data-go="giving">Record a contribution</button></li>
            <li><button data-go="announcements">Post an announcement</button></li>
            <li><button data-go="events">Add an event</button></li>
            ${isAdmin() ? '<li><button data-go="settings">Choose what members see</button></li>' : ''}
          </ul>
        </section>
      </div>`;
  },

  async members() {
    const fams = ok(await sb.from('families').select('*, members(*, organization_memberships(*))').order('family_name'));
    ctx.families = fams;
    if (ctx.familyId) {
      const f = fams.find((x) => x.id === ctx.familyId);
      if (f) return familyDetail(f);
      ctx.familyId = null;
    }
    return `
      <section class="pcard">
        <div class="pcard__head">
          <div><h2>Families &amp; members</h2><p class="muted small">${fams.length} famil${fams.length === 1 ? 'y' : 'ies'} · ${fams.reduce((s, f) => s + f.members.length, 0)} members</p></div>
          <div class="head-actions"><input type="search" id="fam-q" placeholder="Search name, email, number…" aria-label="Search families" value="${esc(ctx.familyQuery)}">
          <button class="btn btn--primary btn--small" id="add-family">+ Add family</button></div>
        </div>
        <div class="table-wrap"><table class="table table--click">
          <thead><tr><th>Family</th><th>Member #</th><th>Prayer group</th><th>Members</th><th>Portal access</th><th>Status</th></tr></thead>
          <tbody id="fam-rows"></tbody></table></div>
        <p class="muted small">To bring in the full register at once, use Supabase → Table Editor → Import CSV (families first, then members).</p>
      </section>`;
  },

  async giving() {
    const fams = ok(await sb.from('families').select('id, family_name, member_number').order('family_name'));
    const recent = ok(await sb.from('contributions').select('*, family:families(family_name)').order('created_at', { ascending: false }).limit(25));
    const y = new Date().getFullYear();
    const pledges = ok(await sb.from('pledges').select('*, family:families(family_name)').eq('year', y).order('amount', { ascending: false }));
    ctx.fams = fams; ctx.recent = recent; ctx.pledges = pledges;
    const famOpts = fams.map((f) => `<option value="${esc(f.id)}">${esc(f.family_name)}${f.member_number ? ' (' + esc(f.member_number) + ')' : ''}</option>`).join('');
    return `
      <div class="grid-2">
        <section class="pcard">
          <h2>Record a contribution</h2>
          <form id="contrib-form" class="form form--flat">
            <label>Family<select name="family_id" required><option value="">Choose a family…</option>${famOpts}</select></label>
            <div class="row-2"><label>Date<input type="date" name="given_on" value="${todayIso()}" required></label><label>Amount ($)<input type="number" name="amount" min="0" step="0.01" required></label></div>
            <div class="row-2"><label>Category<select name="category">${GIVING_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label><label>Method<select name="method">${METHODS.map((c) => `<option>${c}</option>`).join('')}</select></label></div>
            <div class="row-2"><label>Reference / check #<input name="reference"></label><label>Note<input name="note"></label></div>
            <button class="btn btn--primary" type="submit">Save contribution</button>
            <p class="form__msg" role="status"></p>
          </form>
        </section>
        <section class="pcard">
          <div class="pcard__head"><h2>${y} pledges</h2><button class="btn btn--outline btn--small" id="add-pledge">+ Set a pledge</button></div>
          ${pledges.length ? `<div class="table-wrap"><table class="table table--compact"><tbody>${pledges.map((p) => `<tr><td>${esc(p.family?.family_name)}</td><td>${esc(p.category)}</td><td class="num">${money(p.amount)}</td><td class="row-actions"><button class="link-btn link-btn--danger" data-del-pledge="${p.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No pledges recorded for this year.</p>'}
          <hr>
          <h3>Exports</h3>
          <div class="btn-row">
            <button class="btn btn--outline btn--small" id="export-members">Member register (CSV)</button>
            <label class="inline small">Contributions for <select id="export-year">${[y, y - 1, y - 2].map((v) => `<option>${v}</option>`).join('')}</select></label>
            <button class="btn btn--outline btn--small" id="export-contribs">Download (CSV)</button>
          </div>
        </section>
      </div>
      <section class="pcard">
        <h2>Recently recorded</h2>
        ${recent.length ? `<div class="table-wrap"><table class="table table--compact">
          <thead><tr><th>Date</th><th>Family</th><th>Category</th><th>Method</th><th>Ref.</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>${recent.map((c) => `<tr><td>${date(c.given_on)}</td><td>${esc(c.family?.family_name)}</td><td>${esc(c.category)}</td><td>${val(c.method)}</td><td>${val(c.reference)}</td><td class="num">${money(c.amount)}</td><td class="row-actions"><button class="link-btn link-btn--danger" data-del-contrib="${c.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nothing recorded yet.</p>'}
      </section>`;
  },

  announcements: () => announcements.view(),
  events: () => events.view(),
  documents: () => documents.view(),

  async photos() {
    const rows = ok(await sb.from('photo_submissions').select('*, member:members!photo_submissions_member_id_fkey(first_name, last_name)').order('created_at', { ascending: false }));
    ctx.photos = rows;
    const f = ctx.photoFilter;
    const list = rows.filter((r) => r.status === f);
    const counts = { pending: 0, approved: 0, rejected: 0 };
    rows.forEach((r) => counts[r.status]++);
    return `
      <section class="pcard">
        <div class="pcard__head"><div><h2>Member photos</h2><p class="muted small">Approved photos appear on the public Gallery page under “Shared by our members”.</p></div>
          ${f === 'pending' && list.length > 1 ? '<button class="btn btn--primary btn--small" id="approve-all">Approve all</button>' : ''}</div>
        <div class="seg">${[['pending', 'Waiting for review'], ['approved', 'Approved'], ['rejected', 'Not approved']].map(([k, l]) => `<button data-pf="${k}" aria-selected="${k === f}">${l} <span class="muted">${counts[k]}</span></button>`).join('')}</div>
        ${list.length ? `<div class="photo-grid photo-grid--admin" data-lightbox-group>${list.map((p) => `
          <figure class="photo" data-path="${esc(p.storage_path)}">
            <a class="photo__img" data-lightbox href="#"></a>
            <figcaption>
              <strong>${esc(p.event_name || 'Untitled')}</strong>
              ${p.caption ? `<small>${esc(p.caption)}</small>` : ''}
              <small class="muted">${esc(p.member ? p.member.first_name + ' ' + p.member.last_name : '')} · ${date(p.created_at.slice(0, 10))}</small>
              <div class="photo__actions">
                ${p.status !== 'approved' ? `<button class="btn btn--primary btn--small" data-approve="${p.id}">Approve</button>` : ''}
                ${p.status === 'pending' ? `<button class="btn btn--outline btn--small" data-reject="${p.id}">Decline</button>` : ''}
                ${p.status === 'approved' ? `<label class="check small"><input type="checkbox" data-gallery="${p.id}" ${p.show_in_gallery ? 'checked' : ''}> In gallery</label>` : ''}
                <button class="link-btn link-btn--danger small" data-del-photo="${p.id}">Delete</button>
              </div>
            </figcaption>
          </figure>`).join('')}</div>` : `<p class="empty">${f === 'pending' ? 'No photos waiting for review.' : 'Nothing here yet.'}</p>`}
      </section>`;
  },

  async settings() {
    if (!isAdmin()) return '<section class="pcard"><p>Only an admin can change portal settings.</p></section>';
    const s = await getSettings(sb);
    ctx.settings = s;
    return `
      <form id="settings-form" class="settings">
        <section class="pcard">
          <h2>Member portal tabs</h2>
          <p class="muted small">Turn sections of the member portal on or off for everyone.</p>
          <div class="toggles">${MEMBER_TABS.map(([k, l]) => `<label class="toggle"><input type="checkbox" name="tab_${k}" ${s.member_tabs[k] !== false ? 'checked' : ''} ${k === 'overview' || k === 'account' ? 'disabled' : ''}><span>${l}</span></label>`).join('')}</div>
        </section>
        <section class="pcard">
          <h2>Photo sharing</h2>
          <label class="toggle"><input type="checkbox" name="photo_enabled" ${s.photo_uploads.enabled ? 'checked' : ''}><span>Members can submit photos</span></label>
          <div class="form form--flat">
            <label>Largest photo size (MB)<input type="number" name="photo_max" min="1" max="15" value="${esc(s.photo_uploads.max_mb)}"></label>
            <label>Note shown above the upload form<input name="photo_note" value="${esc(s.photo_uploads.note)}" maxlength="240"></label>
          </div>
        </section>
        <section class="pcard">
          <h2>Home page</h2>
          <div class="form form--flat">
            <label class="toggle"><input type="checkbox" name="home_ann" ${s.home.announcements ? 'checked' : ''}><span>Show announcements on the home page</span></label>
            <label>How many announcements<input type="number" name="home_ann_n" min="1" max="10" value="${esc(s.home.announcement_count)}"></label>
            <label class="toggle"><input type="checkbox" name="home_ev" ${s.home.events ? 'checked' : ''}><span>Show upcoming events on the home page</span></label>
            <label>How many events<input type="number" name="home_ev_n" min="1" max="10" value="${esc(s.home.event_count)}"></label>
          </div>
        </section>
        <div class="settings__save"><button class="btn btn--primary" type="submit">Save settings</button><p class="form__msg" role="status"></p></div>
      </form>`;
  }
};

function familyDetail(f) {
  const people = [...f.members].sort((a, b) => RELATIONSHIPS.indexOf(a.relationship) - RELATIONSHIPS.indexOf(b.relationship));
  return `
    <button class="link-btn back" id="back">← All families</button>
    <div class="grid-2 grid-2--wide-right">
      <section class="pcard">
        <div class="pcard__head"><h2>${esc(f.family_name)}</h2><button class="btn btn--outline btn--small" id="edit-family">Edit</button></div>
        <dl class="kvs">
          <div class="kv"><dt>Member #</dt><dd>${val(f.member_number)}</dd></div>
          <div class="kv"><dt>Address</dt><dd>${val([f.address_line1, f.address_line2, [f.city, f.state].filter(Boolean).join(', ') + ' ' + (f.zip || '')].filter((x) => x && x.trim()).join('\n'))}</dd></div>
          <div class="kv"><dt>Home phone</dt><dd>${val(f.home_phone)}</dd></div>
          <div class="kv"><dt>Prayer group</dt><dd>${val(f.prayer_group)}</dd></div>
          <div class="kv"><dt>Home parish</dt><dd>${val(f.home_parish)}</dd></div>
          <div class="kv"><dt>Member since</dt><dd>${f.member_since ? date(f.member_since) : val('')}</dd></div>
          <div class="kv"><dt>Status</dt><dd>${esc(f.status.charAt(0).toUpperCase() + f.status.slice(1))}</dd></div>
        </dl>
        <button class="link-btn link-btn--danger small" id="delete-family">Delete family</button>
      </section>
      <section class="pcard">
        <div class="pcard__head"><h2>Members</h2><button class="btn btn--primary btn--small" id="add-member">+ Add member</button></div>
        ${people.length ? people.map((m) => `
          <article class="person">
            <div class="person__main">
              <h3>${esc(m.first_name)} ${esc(m.last_name)} ${m.role !== 'member' ? `<span class="pill pill--${m.role}">${m.role === 'admin' ? 'Admin' : 'Officer'}</span>` : ''}</h3>
              <p class="muted small">${esc(m.relationship || '')}${m.email ? ' · ' + esc(m.email) : ''}${m.mobile_phone ? ' · ' + esc(m.mobile_phone) : ''}</p>
              <div class="chips">${(m.organization_memberships || []).map((o) => `<span class="chip">${esc(o.organization)}${o.position ? ' · ' + esc(o.position) : ''}<button aria-label="Remove" data-del-org="${o.id}">×</button></span>`).join('')}<button class="chip chip--add" data-add-org="${m.id}">+ Organization</button></div>
            </div>
            <div class="person__side">
              ${m.auth_user_id ? '<span class="status status--approved">Has portal access</span>' : m.email ? '<span class="status">No portal access</span>' : '<span class="status muted">No email</span>'}
              <div class="btn-row">
                <button class="btn btn--outline btn--small" data-edit-member="${m.id}">Edit</button>
                <button class="btn btn--outline btn--small" data-access="${m.id}">Portal access</button>
              </div>
            </div>
          </article>`).join('') : '<p class="empty">No members yet. Add the head of household first.</p>'}
      </section>
    </div>`;
}

function editFamily(f) {
  dialog(f ? 'Edit family' : 'Add family', formHtml(familyFields, f || {}), async (v) => {
    const data = readValues(familyFields, v);
    if (f) { ok(await sb.from('families').update({ ...data, updated_at: new Date().toISOString() }).eq('id', f.id)); }
    else { const row = ok(await sb.from('families').insert(data).select('id').single()); ctx.familyId = row.id; }
    toast('Family saved'); await show('members');
  }, { wide: true });
}

function editMember(m, familyId) {
  const fields = memberFields(m || {});
  dialog(m ? `Edit ${esc(m.first_name)}` : 'Add member', formHtml(fields, m || {}), async (v) => {
    const data = readValues(fields, v);
    if (data.email) data.email = data.email.toLowerCase();
    if (m) ok(await sb.from('members').update(data).eq('id', m.id));
    else ok(await sb.from('members').insert({ ...data, family_id: familyId }));
    toast('Member saved'); await show('members');
  }, { wide: true });
}

function portalAccess(m) {
  const name = `${esc(m.first_name)} ${esc(m.last_name)}`;
  const call = async (body) => {
    const { data, error } = await sb.functions.invoke('admin-users', { body: { ...body, member_id: m.id, redirect_to: PORTAL_URL } });
    if (error) {
      let detail = error.message;
      try { const j = await error.context.json(); detail = j.error || detail; } catch (e) { /* keep message */ }
      throw new Error(detail);
    }
    if (data && data.error) throw new Error(data.error);
    toast(data.message || 'Done'); await show('members');
  };
  if (!m.email) return dialog('Portal access', `<p>${name} needs an email address before they can sign in. Edit their details and add one first.</p>`, null);
  if (!m.auth_user_id) {
    dialog(`Give ${name} portal access`, `
      <p class="muted small">They'll sign in with <strong>${esc(m.email)}</strong>.</p>
      <label class="radio"><input type="radio" name="how" value="invite" checked> <span><strong>Email an invitation</strong><br><small class="muted">They click the link in the email and choose their own password.</small></span></label>
      <label class="radio"><input type="radio" name="how" value="create"> <span><strong>Set a starting password</strong><br><small class="muted">Share it with them in person; they can change it under Account.</small></span></label>
      <label>Starting password<input type="text" name="password" minlength="8" autocomplete="off" placeholder="At least 8 characters"></label>`,
      (v) => v.how === 'create' ? call({ action: 'create', password: v.password }) : call({ action: 'invite' }), { saveLabel: 'Give access' });
    return;
  }
  if (!isAdmin()) return dialog('Portal access', `<p>${name} already has portal access. Ask an admin if their password needs resetting.</p>`, null);
  const d = dialog(`${name} — portal access`, `
    <p class="muted small">Signs in as <strong>${esc(m.email)}</strong>.</p>
    <label>New password<input type="text" name="password" minlength="8" autocomplete="off" placeholder="At least 8 characters"></label>
    <p class="small"><button type="button" class="link-btn link-btn--danger" data-revoke>Remove portal access instead</button></p>`,
    (v) => { if (!v.password) throw new Error('Enter a new password.'); return call({ action: 'set_password', password: v.password }); }, { saveLabel: 'Reset password' });
  $('[data-revoke]', d).onclick = () => { d.close(); confirmDialog('Remove portal access?', `${name} won't be able to sign in. Their parish record stays as it is.`, () => call({ action: 'revoke' }), 'Remove access'); };
}

function addOrg(memberId) {
  dialog('Add to an organization', `
    <label>Organization<select name="organization" required>${ORGS.map((o) => `<option>${esc(o)}</option>`).join('')}<option value="__other">Other…</option></select></label>
    <label>Other organization<input name="other" placeholder="Only if you chose Other"></label>
    <label>Position (optional)<input name="position" placeholder="Member, Secretary, Teacher…"></label>`, async (v) => {
    const organization = v.organization === '__other' ? (v.other || '').trim() : v.organization;
    if (!organization) throw new Error('Enter the organization name.');
    ok(await sb.from('organization_memberships').insert({ member_id: memberId, organization, position: (v.position || '').trim() || null }));
    toast('Added'); await show('members');
  });
}

async function signedThumbs(paths) {
  if (!paths.length) return {};
  const rows = ok(await sb.storage.from('member-photos').createSignedUrls(paths, 3600));
  return Object.fromEntries(rows.filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]));
}

const BIND = {
  overview() {
    $$('[data-go]', view).forEach((b) => (b.onclick = async () => { await show(b.dataset.go); if ('newFamily' in b.dataset) editFamily(null); }));
  },
  members() {
    if (ctx.familyId) {
      const f = ctx.families.find((x) => x.id === ctx.familyId);
      $('#back').onclick = () => { ctx.familyId = null; show('members'); };
      $('#edit-family').onclick = () => editFamily(f);
      $('#add-member').onclick = () => editMember(null, f.id);
      $('#delete-family').onclick = () => confirmDialog('Delete this family?', `${esc(f.family_name)}, all ${f.members.length} member record(s) and their giving history will be permanently deleted. Members with portal access should have it removed first.`, async () => {
        if (f.members.some((m) => m.auth_user_id)) throw new Error('Remove portal access for everyone in this family first.');
        ok(await sb.from('families').delete().eq('id', f.id)); ctx.familyId = null; toast('Family deleted'); await show('members');
      });
      const byId = Object.fromEntries(f.members.map((m) => [m.id, m]));
      $$('[data-edit-member]', view).forEach((b) => (b.onclick = () => editMember(byId[b.dataset.editMember], f.id)));
      $$('[data-access]', view).forEach((b) => (b.onclick = () => portalAccess(byId[b.dataset.access])));
      $$('[data-add-org]', view).forEach((b) => (b.onclick = () => addOrg(b.dataset.addOrg)));
      $$('[data-del-org]', view).forEach((b) => (b.onclick = async () => { ok(await sb.from('organization_memberships').delete().eq('id', b.dataset.delOrg)); toast('Removed'); show('members'); }));
      return;
    }
    const draw = () => {
      const t = ctx.familyQuery.toLowerCase();
      const rows = ctx.families.filter((f) => !t || [f.family_name, f.member_number, f.prayer_group, ...f.members.flatMap((m) => [m.first_name, m.last_name, m.email])].join(' ').toLowerCase().includes(t));
      $('#fam-rows').innerHTML = rows.map((f) => `<tr data-family="${f.id}" tabindex="0"><td><strong>${esc(f.family_name)}</strong></td><td>${val(f.member_number)}</td><td>${val(f.prayer_group)}</td><td>${f.members.length}</td><td>${f.members.filter((m) => m.auth_user_id).length}</td><td>${f.status === 'active' ? 'Active' : esc(f.status)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${ctx.families.length ? 'No matches.' : 'No families yet — add the first one.'}</td></tr>`;
      $$('[data-family]', view).forEach((r) => { const open = () => { ctx.familyId = r.dataset.family; show('members'); }; r.onclick = open; r.onkeydown = (e) => { if (e.key === 'Enter') open(); }; });
    };
    draw();
    $('#fam-q').oninput = (e) => { ctx.familyQuery = e.target.value; draw(); };
    $('#add-family').onclick = () => editFamily(null);
  },
  giving() {
    const f = $('#contrib-form');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const p = Object.fromEntries(new FormData(f));
      if (!p.family_id || !p.amount) return msg(f, 'Choose a family and enter an amount.', true);
      busy(f, true);
      try {
        ok(await sb.from('contributions').insert({ family_id: p.family_id, given_on: p.given_on, amount: Number(p.amount), category: p.category, method: p.method, reference: p.reference.trim() || null, note: p.note.trim() || null }));
        toast(`Saved ${money(p.amount)} for ${ctx.fams.find((x) => x.id === p.family_id).family_name}`);
        await show('giving');
      } catch (err) { msg(f, friendly(err), true); busy(f, false); }
    };
    $('#add-pledge').onclick = () => dialog('Set a pledge', `
      <label>Family<select name="family_id" required><option value="">Choose a family…</option>${ctx.fams.map((x) => `<option value="${esc(x.id)}">${esc(x.family_name)}</option>`).join('')}</select></label>
      <div class="row-3"><label>Year<input type="number" name="year" value="${new Date().getFullYear()}" required></label><label>Category<select name="category">${GIVING_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label><label>Amount ($)<input type="number" name="amount" min="0" step="0.01" required></label></div>`,
      async (v) => { ok(await sb.from('pledges').upsert({ family_id: v.family_id, year: Number(v.year), category: v.category, amount: Number(v.amount) }, { onConflict: 'family_id,year,category' })); toast('Pledge saved'); await show('giving'); });
    $$('[data-del-pledge]', view).forEach((b) => (b.onclick = async () => { ok(await sb.from('pledges').delete().eq('id', b.dataset.delPledge)); toast('Pledge removed'); show('giving'); }));
    $$('[data-del-contrib]', view).forEach((b) => (b.onclick = () => {
      const c = ctx.recent.find((x) => x.id === b.dataset.delContrib);
      confirmDialog('Delete this contribution?', `${money(c.amount)} from ${esc(c.family?.family_name)} on ${date(c.given_on)}.`, async () => { ok(await sb.from('contributions').delete().eq('id', c.id)); toast('Deleted'); await show('giving'); });
    }));
    $('#export-members').onclick = async () => {
      const rows = ok(await sb.from('members').select('first_name, last_name, relationship, email, mobile_phone, date_of_birth, wedding_date, baptized, confirmed, role, directory_opt_in, family:families(family_name, member_number, address_line1, address_line2, city, state, zip, home_phone, prayer_group, home_parish, member_since, status)').order('last_name'));
      download(`mtca-member-register-${todayIso()}.csv`, csv(rows));
    };
    $('#export-contribs').onclick = async () => {
      const y = $('#export-year').value;
      const rows = ok(await sb.from('contributions').select('given_on, category, amount, method, reference, note, family:families(family_name, member_number)').gte('given_on', `${y}-01-01`).lte('given_on', `${y}-12-31`).order('given_on'));
      download(`mtca-contributions-${y}.csv`, csv(rows));
    };
  },
  announcements: () => announcements.bind(),
  events: () => events.bind(),
  documents: () => documents.bind(),
  async photos() {
    $$('[data-pf]', view).forEach((b) => (b.onclick = () => { ctx.photoFilter = b.dataset.pf; show('photos'); }));
    const figs = $$('[data-path]', view);
    const urls = await signedThumbs(figs.map((f) => f.dataset.path)).catch(() => ({}));
    figs.forEach((f) => { const u = urls[f.dataset.path]; if (u) { const a = $('.photo__img', f); a.style.backgroundImage = `url("${u}")`; a.href = u; } });
    const review = async (ids, status) => {
      ok(await sb.from('photo_submissions').update({ status, reviewed_at: new Date().toISOString(), reviewed_by: me.id }).in('id', ids));
      toast(status === 'approved' ? `Approved ${ids.length > 1 ? ids.length + ' photos' : ''}`.trim() : 'Declined'); await show('photos');
    };
    $$('[data-approve]', view).forEach((b) => (b.onclick = () => review([b.dataset.approve], 'approved')));
    $$('[data-reject]', view).forEach((b) => (b.onclick = () => review([b.dataset.reject], 'rejected')));
    const all = $('#approve-all');
    if (all) all.onclick = () => review(ctx.photos.filter((p) => p.status === 'pending').map((p) => p.id), 'approved');
    $$('[data-gallery]', view).forEach((c) => (c.onchange = async () => { ok(await sb.from('photo_submissions').update({ show_in_gallery: c.checked }).eq('id', c.dataset.gallery)); toast(c.checked ? 'Shown in gallery' : 'Hidden from gallery'); }));
    $$('[data-del-photo]', view).forEach((b) => (b.onclick = () => {
      const p = ctx.photos.find((x) => x.id === b.dataset.delPhoto);
      confirmDialog('Delete this photo?', 'The photo file will be permanently deleted.', async () => {
        ok(await sb.from('photo_submissions').delete().eq('id', p.id));
        await sb.storage.from('member-photos').remove([p.storage_path]);
        toast('Photo deleted'); await show('photos');
      });
    }));
  },
  settings() {
    const f = $('#settings-form');
    if (!f) return;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const tabs = Object.fromEntries(MEMBER_TABS.map(([k]) => [k, k === 'overview' || k === 'account' ? true : f[`tab_${k}`].checked]));
      const rows = [
        { key: 'member_tabs', value: tabs },
        { key: 'photo_uploads', value: { enabled: f.photo_enabled.checked, max_mb: Math.min(15, Math.max(1, Number(f.photo_max.value) || 10)), note: f.photo_note.value.trim() } },
        { key: 'home', value: { announcements: f.home_ann.checked, announcement_count: Number(f.home_ann_n.value) || 3, events: f.home_ev.checked, event_count: Number(f.home_ev_n.value) || 4 } }
      ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
      busy(f, true);
      try { ok(await sb.from('portal_settings').upsert(rows, { onConflict: 'key' })); msg(f, 'Saved. Members will see the changes the next time they open the portal.'); toast('Settings saved'); }
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
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { authView.hidden = false; appView.hidden = true; return; }
  me = ok(await sb.from('members').select('id, first_name, last_name, role').eq('auth_user_id', session.user.id).maybeSingle());
  if (!me || !['officer', 'admin'].includes(me.role)) {
    authView.hidden = true; appView.hidden = false;
    $('#tabs').hidden = true;
    $('#hello').textContent = 'Admin';
    view.innerHTML = `<section class="pcard"><h2>No admin access</h2><p>You’re signed in, but your account isn’t set up as a parish officer. Ask an admin to change your portal role, or go to the <a href="../members/">member portal</a>.</p></section>`;
    return;
  }
  authView.hidden = true; appView.hidden = false;
  $('#tabs').hidden = false;
  $$('[data-admin-only]').forEach((b) => (b.hidden = !isAdmin()));
  $('#hello').textContent = `Welcome, ${me.first_name}`;
  const start = location.hash.slice(1);
  show(VIEWS[start] && !(start === 'settings' && !isAdmin()) ? start : 'overview');
}

(async function init() {
  try { sb = await getClient(); } catch (e) { sb = null; }
  if (!sb) { loading.textContent = 'The admin area could not load. Please check your connection and refresh.'; return; }
  await route();
})();
