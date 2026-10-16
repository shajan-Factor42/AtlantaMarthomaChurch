// Mar Thoma Church, Atlanta — parish admin
import {
  getClient, ok, $, $$, esc, val, money, date, dateTime, todayIso, friendly, msg, busy, toast,
  dialog, confirmDialog, getSettings, csv, download, localToIso, isoToLocal, prepareImage, mediaUrl,
  WORSHIP_LANGS, WORSHIP_DEFAULT, fmtTime, nextSundays, sundayInfo, lectionaryEnglish
} from './common.js';
import { buildNewsletterPdf, eventWhen } from './newsletter-pdf.js';

const ORGS = (window.MTCA && window.MTCA.orgs) || [];
const PORTAL_URL = new URL('../members/', location.href).href;
const RELATIONSHIPS = ['Head', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Grandparent', 'Sibling', 'Other'];
const GIVING_CATEGORIES = ['Subscription', 'Sunday Offering', 'Thanksgiving', 'Mission', 'Building Fund', 'Harvest Festival', 'Other'];
const METHODS = ['Check', 'Zelle', 'Cash', 'Online'];
const EVENT_CATEGORIES = ['Worship', 'Parish', 'Youth', 'Sunday School', 'Sevika Sangham', 'Fellowship', 'Community', 'Diocese', 'Special'];
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
  const email = loginForm.email.value.trim(), password = loginForm.password.value.trim();
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
    case 'flyer': return `<div class="flyer-field"><span class="flyer-field__label">${f.label}</span>
      ${v ? `<div class="flyer-field__current"><img src="${esc(mediaUrl(v))}" alt="Current flyer"><label class="check"><input type="checkbox" name="${f.name}_remove"> Remove this flyer</label></div>` : ''}
      <input type="file" name="${f.name}_file" accept="image/jpeg,image/png,image/webp,image/gif">
      <small class="muted">${v ? 'Choose a new image to replace it. ' : ''}JPG or PNG, up to 10 MB. Shown with the ${f.where || 'post'}.</small></div>`;
    case 'datetime': return `<label>${f.label}<input type="datetime-local" ${name} value="${esc(isoToLocal(v))}" ${req} ${dis}>${hint}</label>`;
    default: return `<label>${f.label}<input type="${f.type || 'text'}" ${name} value="${esc(value)}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${req} ${dis}>${hint}</label>`;
  }
}
const formHtml = (fields, row = {}) => fields.map((f) => f.row ? `<div class="row-${f.row.length}">${f.row.map((g) => input(g, row[g.name])).join('')}</div>` : input(f, row[f.name])).join('');
const flatFields = (fields) => fields.flatMap((f) => f.row || [f]);
function readValues(fields, values) {
  const out = {};
  flatFields(fields).forEach((f) => {
    if (f.disabled || f.virtual || f.type === 'flyer') return;
    let v = values[f.name];
    if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'datetime') v = v ? localToIso(v) : null;
    else if (f.type === 'number') v = v === '' || v === undefined ? null : Number(v);
    else v = typeof v === 'string' ? (v.trim() || null) : v ?? null;
    out[f.name] = v;
  });
  return out;
}

/** Upload / replace / remove the flyer image for an event or announcement. */
async function saveFlyer(d, form, row) {
  const file = form.flyer_url_file && form.flyer_url_file.files[0];
  const remove = form.flyer_url_remove && form.flyer_url_remove.checked;
  const old = row && row.flyer_url;
  const ownPath = (u) => { const m = u && u.match(/\/storage\/v1\/object\/public\/flyers\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; };
  if (file) {
    if (!/^image\//.test(file.type)) throw new Error('The flyer must be an image (JPG or PNG).');
    const img = await prepareImage(file, 2000, 0.85);
    if (img.size > 10 * 1048576) throw new Error('The flyer image must be 10 MB or smaller.');
    const path = `${new Date().getFullYear()}/${Date.now()}-${img.name.replace(/[^\w.\-]+/g, '-').toLowerCase()}`;
    ok(await sb.storage.from('flyers').upload(path, img, { contentType: img.type || 'image/jpeg', cacheControl: '31536000' }));
    d.flyer_url = sb.storage.from('flyers').getPublicUrl(path).data.publicUrl;
  } else if (remove) {
    d.flyer_url = null;
  }
  if ((file || remove) && ownPath(old)) await sb.storage.from('flyers').remove([ownPath(old)]).catch(() => {});
  return d;
}
const flyerThumb = (r) => r.flyer_url ? `<img class="flyer-thumb" src="${esc(mediaUrl(r.flyer_url))}" alt="" loading="lazy">` : '';

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
    { name: 'flyer_url', label: 'Flyer (optional)', type: 'flyer', where: 'announcement' },
    { name: 'pinned', label: 'Pin to the top', type: 'checkbox' }
  ],
  beforeSave: saveFlyer,
  onDelete: (row) => saveFlyer({}, { flyer_url_remove: { checked: true } }, row),
  columns: [
    { label: 'Title', render: (r) => `${flyerThumb(r)}<strong>${esc(r.title)}</strong>${r.pinned ? ' <span class="badge">Pinned</span>' : ''}<br><small class="muted clamp">${esc(r.body)}</small>` },
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
    { name: 'description', label: 'Details', type: 'textarea', rows: 4, hint: 'Web addresses you type here become clickable links.' },
    { name: 'link_url', label: 'Registration or details link (optional)', type: 'url', placeholder: 'https://' },
    { name: 'flyer_url', label: 'Flyer (optional)', type: 'flyer', where: 'event on the calendar' },
    { name: 'published', label: 'Published (visible on the calendar)', type: 'checkbox', default: true },
    { name: 'members_only', label: 'Members only (hide from the public calendar)', type: 'checkbox' }
  ],
  beforeSave: (d, form, row) => { if (d.ends_at && new Date(d.ends_at) < new Date(d.starts_at)) throw new Error('The end time is before the start time.'); return saveFlyer(d, form, row); },
  onDelete: (row) => saveFlyer({}, { flyer_url_remove: { checked: true } }, row),
  columns: [
    { label: 'When', render: (r) => `<span class="nowrap">${esc(dateTime(r.starts_at, r.all_day))}</span>` },
    { label: 'Event', render: (r) => `${flyerThumb(r)}<strong>${esc(r.title)}</strong>${r.location ? `<br><small class="muted">${esc(r.location)}</small>` : ''}` },
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
  if (b) { if (b.dataset.tab === 'newsletters') ctx.nlId = null; if (b.dataset.tab === 'newmembers') ctx.nmId = null; if (b.dataset.tab === 'members') { ctx.familyId = null; if (ctx.membersMode === 'upload') { ctx.membersMode = 'families'; ctx.dirPlan = null; } } show(b.dataset.tab); }
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
  if (typeof refreshNmCount === 'function') refreshNmCount();
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
    if (ctx.membersMode === 'upload' && !ctx.familyId) {
      return `<button class="link-btn back" id="back-members">← Back to members</button>` + await uploadView();
    }
    const fams = ok(await sb.from('families').select('*, members(*, organization_memberships(*))').order('family_name'));
    ctx.families = fams;
    if (ctx.familyId) {
      const f = fams.find((x) => x.id === ctx.familyId);
      if (f) return familyDetail(f);
      ctx.familyId = null;
    }
    const people = fams.reduce((s, f) => s + f.members.length, 0);
    const mode = ctx.membersMode === 'directory' ? 'directory' : 'families';
    return `
      <section class="pcard">
        <div class="pcard__head">
          <div><h2>Members</h2><p class="muted small">${fams.length} famil${fams.length === 1 ? 'y' : 'ies'} · ${people} member${people === 1 ? '' : 's'}</p></div>
          <div class="head-actions">
            <button class="btn btn--outline btn--small" id="bulk-upload">⇪ Bulk upload</button>
            <button class="btn btn--primary btn--small" id="add-family">+ Add family</button>
          </div>
        </div>
        <div class="members-toolbar">
          <div class="seg" role="tablist">
            <button data-mode="families" aria-selected="${mode === 'families'}">Families <span class="muted">${fams.length}</span></button>
            <button data-mode="directory" aria-selected="${mode === 'directory'}">Directory <span class="muted">${people}</span></button>
          </div>
          <input type="search" id="fam-q" placeholder="${mode === 'families' ? 'Search families, names, emails…' : 'Search names, emails, phones…'}" aria-label="Search" value="${esc(ctx.familyQuery)}">
        </div>
        ${mode === 'families' ? `
        <div class="table-wrap"><table class="table table--click">
          <thead><tr><th>Family</th><th>Member #</th><th>Prayer group</th><th>Members</th><th>Portal access</th><th>Status</th></tr></thead>
          <tbody id="fam-rows"></tbody></table></div>` : `
        <p class="muted small">Every person in the register. Edit anyone's details here; the <strong>In directory</strong> switch controls whether they appear in the members' parish directory.</p>
        <div class="table-wrap"><table class="table table--compact dir-table">
          <thead><tr><th>Name</th><th>Family</th><th>Email</th><th>Mobile</th><th>Prayer group</th><th>In directory</th><th></th></tr></thead>
          <tbody id="dir-rows"></tbody></table></div>`}
      </section>`;
  },

  async giving() {
    const iconRow = (await sb.from('portal_settings').select('value').eq('key', 'icon').maybeSingle()).data;
    const fromIcon = !!(iconRow && iconRow.value && iconRow.value.giving_from_icon);
    ctx.fromIcon = fromIcon;
    const fams = ok(await sb.from('families').select('id, family_name, member_number').order('family_name'));
    const recent = ok(await sb.from('contributions').select('*, family:families(family_name)').order(fromIcon ? 'given_on' : 'created_at', { ascending: false }).limit(25));
    const y = new Date().getFullYear();
    const pledges = ok(await sb.from('pledges').select('*, family:families(family_name)').eq('year', y).order('amount', { ascending: false }));
    ctx.fams = fams; ctx.recent = recent; ctx.pledges = pledges;
    const famOpts = fams.map((f) => `<option value="${esc(f.id)}">${esc(f.family_name)}${f.member_number ? ' (' + esc(f.member_number) + ')' : ''}</option>`).join('');
    return `
      <div class="grid-2">
        ${fromIcon ? `<section class="pcard">
          <h2>Gifts come from ICON</h2>
          <p>Contributions and pledges are recorded in IconCMO and copied here every night, so each family’s giving statement in the portal matches ICON.</p>
          <p class="muted small">To add or correct a gift, do it in ICON. It shows up here after the next sync — or right away with <strong>Sync now</strong> under Portal Settings → ICON.</p>
        </section>` : `<section class="pcard">
          <h2>Record a contribution</h2>
          <form id="contrib-form" class="form form--flat">
            <label>Family<select name="family_id" required><option value="">Choose a family…</option>${famOpts}</select></label>
            <div class="row-2"><label>Date<input type="date" name="given_on" value="${todayIso()}" required></label><label>Amount ($)<input type="number" name="amount" min="0" step="0.01" required></label></div>
            <div class="row-2"><label>Category<select name="category">${GIVING_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label><label>Method<select name="method">${METHODS.map((c) => `<option>${c}</option>`).join('')}</select></label></div>
            <div class="row-2"><label>Reference / check #<input name="reference"></label><label>Note<input name="note"></label></div>
            <button class="btn btn--primary" type="submit">Save contribution</button>
            <p class="form__msg" role="status"></p>
          </form>
        </section>`}
        <section class="pcard">
          <div class="pcard__head"><h2>${y} pledges</h2>${fromIcon ? '<span class="pill">From ICON</span>' : '<button class="btn btn--outline btn--small" id="add-pledge">+ Set a pledge</button>'}</div>
          ${pledges.length ? `<div class="table-wrap"><table class="table table--compact"><tbody>${pledges.map((p) => `<tr><td>${esc(p.family?.family_name)}</td><td>${esc(p.category)}</td><td class="num">${money(p.amount)}</td><td class="row-actions">${p.icon_id ? '' : `<button class="link-btn link-btn--danger" data-del-pledge="${p.id}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No pledges recorded for this year.</p>'}
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
        <h2>${fromIcon ? 'Latest gifts' : 'Recently recorded'}</h2>
        ${recent.length ? `<div class="table-wrap"><table class="table table--compact">
          <thead><tr><th>Date</th><th>Family</th><th>Category</th><th>Method</th><th>Ref.</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>${recent.map((c) => `<tr><td>${date(c.given_on)}</td><td>${esc(c.family?.family_name)}</td><td>${esc(c.category)}</td><td>${val(c.method)}</td><td>${val(c.reference)}</td><td class="num">${money(c.amount)}</td><td class="row-actions">${c.source === 'icon' ? '<span class="pill" title="Synced from ICON">ICON</span>' : `<button class="link-btn link-btn--danger" data-del-contrib="${c.id}">Delete</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nothing recorded yet.</p>'}
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
        <div class="pcard__head"><div><h2>Photos</h2><p class="muted small">Approved photos appear on the public Gallery page. Photos you upload here are published straight away.</p></div>
          <div class="head-actions">
            ${f === 'pending' && list.length > 1 ? '<button class="btn btn--outline btn--small" id="approve-all">Approve all</button>' : ''}
            <button class="btn btn--primary btn--small" id="upload-photos">⇪ Upload photos</button>
          </div></div>
        <form id="admin-photo-form" class="form form--flat admin-upload" hidden>
          <label class="drop" id="admin-drop">
            <input type="file" name="files" accept="image/jpeg,image/png,image/webp,image/gif" multiple required>
            <span class="drop__text"><strong>Choose photos</strong> or drag them here<br><small>JPEG, PNG or WebP · up to 50 at a time · large photos are resized automatically</small></span>
          </label>
          <div id="admin-previews" class="thumbs"></div>
          <div class="row-2">
            <label>Event or occasion <input name="event_name" placeholder="e.g. Harvest Festival 2026" maxlength="120"></label>
            <label>Caption (optional) <input name="caption" maxlength="300"></label>
          </div>
          <label class="check"><input type="checkbox" name="show_in_gallery" checked> Show on the public Gallery page</label>
          <div class="btn-row"><button class="btn btn--primary" type="submit">Upload and publish</button><button class="btn btn--outline" type="button" id="cancel-upload">Cancel</button></div>
          <div class="progress" hidden><i></i></div>
          <p class="form__msg" role="status"></p>
        </form>
        <div class="seg">${[['pending', 'Waiting for review'], ['approved', 'Approved'], ['rejected', 'Not approved']].map(([k, l]) => `<button data-pf="${k}" aria-selected="${k === f}">${l} <span class="muted">${counts[k]}</span></button>`).join('')}</div>
        ${list.length ? `<div class="photo-grid photo-grid--admin" data-lightbox-group>${list.map((p) => `
          <figure class="photo" data-path="${esc(p.storage_path)}">
            <a class="photo__img" data-lightbox href="#"></a>
            <figcaption>
              <strong>${esc(p.event_name || 'Untitled')}</strong>
              ${p.caption ? `<small>${esc(p.caption)}</small>` : ''}
              <small class="muted">${p.reviewed_by && p.reviewed_by === p.member_id && p.status === 'approved' ? 'Uploaded by ' : ''}${esc(p.member ? p.member.first_name + ' ' + p.member.last_name : '')} · ${date(p.created_at.slice(0, 10))}</small>
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
    const { data: refRow } = await sb.from('portal_settings').select('value').eq('key', 'mitra_refs').maybeSingle();
    const refs = { marthoma: true, urls: [], ...(refRow?.value || {}) };
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
        <section class="pcard">
          <h2>Mitra AI chat</h2>
          <p class="muted small">The “Ask Mitra AI” chat on the public site and member portal. It answers from the website, events, home-page announcements and the reference sources below.</p>
          <label class="toggle"><input type="checkbox" name="chat_enabled" ${s.chat.enabled !== false ? 'checked' : ''}><span>Show Mitra AI</span></label>
          <label class="toggle"><input type="checkbox" name="chat_voice" ${s.chat.voice !== false ? 'checked' : ''}><span>Allow voice — visitors can speak questions and hear replies (uses the browser’s built-in voices, no cost)</span></label>
          <div class="form form--flat">
            <label>Greeting<textarea name="chat_greeting" rows="3" maxlength="400">${esc(s.chat.greeting || '')}</textarea></label>
            <label>Messages allowed per visitor per hour<input type="number" name="chat_hourly" min="5" max="200" value="${esc(s.chat.hourly_limit ?? 30)}"></label>
          </div>
        </section>
        <section class="pcard">
          <div class="pcard__head"><h2>Mitra AI reference sources</h2><button class="btn btn--outline btn--small" type="button" id="refs-refresh">Refresh now</button></div>
          <p class="muted small">Mitra AI keeps a copy of these sites and checks them every hour, so it can answer questions about the lectionary, Kalpanas and the wider Mar Thoma Church.</p>
          <label class="toggle"><input type="checkbox" name="refs_marthoma" ${refs.marthoma !== false ? 'checked' : ''}><span>Use marthoma.in (lectionary, Kalpanas, Sabha pages and news)</span></label>
          <div id="refs-status" class="refs-status muted small">Checking sources…</div>
          <div class="form form--flat">
            <label>Other pages Mitra AI may use <small class="muted">— one web address per line, up to 25</small><textarea name="refs_urls" rows="3" placeholder="https://example.org/page">${esc((refs.urls || []).join('\n'))}</textarea></label>
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
    if (ctx.membersMode === 'upload' && !ctx.familyId) {
      $('#back-members').onclick = () => { ctx.membersMode = 'families'; ctx.dirPlan = null; show('members'); };
      return bindUpload();
    }
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
    const mode = ctx.membersMode === 'directory' ? 'directory' : 'families';
    $$('[data-mode]', view).forEach((b) => (b.onclick = () => { ctx.membersMode = b.dataset.mode; show('members'); }));
    $('#add-family').onclick = () => editFamily(null);
    $('#bulk-upload').onclick = () => { ctx.membersMode = 'upload'; ctx.dirPlan = null; show('members'); };
    const openFamily = (id) => { ctx.familyId = id; show('members'); };
    const t = () => ctx.familyQuery.toLowerCase();
    const drawFamilies = () => {
      const rows = ctx.families.filter((f) => !t() || [f.family_name, f.member_number, f.prayer_group, ...f.members.flatMap((m) => [m.first_name, m.last_name, m.email])].join(' ').toLowerCase().includes(t()));
      $('#fam-rows').innerHTML = rows.map((f) => `<tr data-family="${f.id}" tabindex="0"><td><strong>${esc(f.family_name)}</strong></td><td>${val(f.member_number)}</td><td>${val(f.prayer_group)}</td><td>${f.members.length}</td><td>${f.members.filter((m) => m.auth_user_id).length}</td><td>${f.status === 'active' ? 'Active' : esc(f.status)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${ctx.families.length ? 'No matches.' : 'No families yet — add one, or use Bulk upload.'}</td></tr>`;
      $$('[data-family]', view).forEach((r) => { r.onclick = () => openFamily(r.dataset.family); r.onkeydown = (e) => { if (e.key === 'Enter') openFamily(r.dataset.family); }; });
    };
    const everyone = () => ctx.families.flatMap((f) => f.members.map((m) => ({ ...m, _fam: f })))
      .sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));
    const drawDirectory = () => {
      const rows = everyone().filter((m) => !t() || [m.first_name, m.last_name, m.email, m.mobile_phone, m._fam.family_name, m._fam.member_number, m._fam.prayer_group].join(' ').toLowerCase().includes(t()));
      $('#dir-rows').innerHTML = rows.map((m) => `<tr>
          <td><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong>${m.role !== 'member' ? ` <span class="pill pill--${m.role}">${m.role === 'admin' ? 'Admin' : 'Officer'}</span>` : ''}<br><small class="muted">${esc(m.relationship || '')}</small></td>
          <td><button class="link-btn" data-open-family="${m._fam.id}">${esc(m._fam.family_name)}</button></td>
          <td>${val(m.email)}</td><td class="nowrap">${val(m.mobile_phone)}</td><td>${val(m._fam.prayer_group)}</td>
          <td><label class="switch" title="Show in the members' directory"><input type="checkbox" data-optin="${m.id}" ${m.directory_opt_in ? 'checked' : ''}><span></span></label></td>
          <td class="row-actions"><button class="btn btn--outline btn--small" data-edit-person="${m.id}">Edit</button></td></tr>`).join('')
        || `<tr><td colspan="7" class="empty">${ctx.families.length ? 'No matches.' : 'No members yet — add a family, or use Bulk upload.'}</td></tr>`;
      const byId = Object.fromEntries(everyone().map((m) => [m.id, m]));
      $$('[data-open-family]', view).forEach((b) => (b.onclick = () => openFamily(b.dataset.openFamily)));
      $$('[data-edit-person]', view).forEach((b) => (b.onclick = () => editMember(byId[b.dataset.editPerson], byId[b.dataset.editPerson].family_id)));
      $$('[data-optin]', view).forEach((c) => (c.onchange = async () => {
        try {
          ok(await sb.from('members').update({ directory_opt_in: c.checked }).eq('id', c.dataset.optin));
          byId[c.dataset.optin].directory_opt_in = c.checked;
          ctx.families.forEach((f) => f.members.forEach((m) => { if (m.id === c.dataset.optin) m.directory_opt_in = c.checked; }));
          toast(c.checked ? 'Listed in the directory' : 'Hidden from the directory');
        } catch (e) { c.checked = !c.checked; toast(friendly(e), true); }
      }));
    };
    const draw = mode === 'families' ? drawFamilies : drawDirectory;
    draw();
    $('#fam-q').oninput = (e) => { ctx.familyQuery = e.target.value; draw(); };
  },
  giving() {
    const f = $('#contrib-form');
    if (f) f.onsubmit = async (e) => {
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
    const addPledge = $('#add-pledge');
    if (addPledge) addPledge.onclick = () => dialog('Set a pledge', `
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
    bindAdminUpload();
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
    const box = $('#refs-status');
    const showStatus = (st) => { box.innerHTML = refsSummary(st); };
    const call = async (body) => {
      const { data, error } = await sb.functions.invoke('mitra-sources', { body });
      if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch { /* keep */ } throw new Error(m); }
      return data;
    };
    call({ action: 'status' }).then((d) => showStatus(d.status)).catch(() => { box.textContent = 'Couldn’t load the source status right now.'; });
    $('#refs-refresh').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Refreshing… (up to 2 min)';
      try { const d = await call({ force: true }); showStatus(d.status); toast('Sources refreshed'); }
      catch (err) { toast(friendly(err)); }
      finally { b.disabled = false; b.textContent = 'Refresh now'; }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const tabs = Object.fromEntries(MEMBER_TABS.map(([k]) => [k, k === 'overview' || k === 'account' ? true : f[`tab_${k}`].checked]));
      const rows = [
        { key: 'member_tabs', value: tabs },
        { key: 'photo_uploads', value: { enabled: f.photo_enabled.checked, max_mb: Math.min(15, Math.max(1, Number(f.photo_max.value) || 10)), note: f.photo_note.value.trim() } },
        { key: 'home', value: { announcements: f.home_ann.checked, announcement_count: Number(f.home_ann_n.value) || 3, events: f.home_ev.checked, event_count: Number(f.home_ev_n.value) || 4 } },
        { key: 'chat', value: { ...(ctx.settings.chat || {}), enabled: f.chat_enabled.checked, voice: f.chat_voice.checked, greeting: f.chat_greeting.value.trim(), hourly_limit: Math.min(200, Math.max(5, Number(f.chat_hourly.value) || 30)) } },
        { key: 'mitra_refs', value: { marthoma: f.refs_marthoma.checked, urls: refUrls(f.refs_urls.value) } }
      ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
      busy(f, true);
      try { ok(await sb.from('portal_settings').upsert(rows, { onConflict: 'key' })); f.refs_urls.value = rows.find((r) => r.key === 'mitra_refs').value.urls.join('\n'); msg(f, 'Saved. Members will see the changes the next time they open the portal.'); toast('Settings saved'); }
      catch (err) { msg(f, friendly(err), true); }
      finally { busy(f, false); }
    };
  }
};


function refUrls(text) {
  return [...new Set(text.split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(u)))].slice(0, 25);
}

function refsSummary(st = {}) {
  const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : dateTime(iso); };
  const l = st.lectionary || {}, c = st.circulars || {};
  const cTotal = Object.values(c).reduce((a, b) => a + b, 0);
  return `<ul class="refs-list">
    <li><strong>Lectionary:</strong> ${l.entries ? `${l.entries} Sundays and feast days, ${date(l.from)} – ${date(l.to)}` : 'not loaded yet'}</li>
    <li><strong>Kalpanas:</strong> ${cTotal ? `${cTotal} listed; full text read for ${c.ok || 0}${c.pending ? `, ${c.pending} still to read` : ''}${c.garbled || c.empty ? ` (${(c.garbled || 0) + (c.empty || 0)} are scans or old-font Malayalam, so Mitra AI shares the title and link)` : ''}` : 'not loaded yet'}</li>
    <li><strong>Pages and news:</strong> ${st.pages || 0} pages, ${st.news || 0} news items</li>
    <li><strong>Last checked:</strong> ${ago(st.last_run)}</li>
  </ul>`;
}

/** Admin photo upload: published immediately, no review needed. */
function bindAdminUpload() {
  const form = $('#admin-photo-form');
  const input = form.files, drop = $('#admin-drop'), previews = $('#admin-previews');
  $('#upload-photos').onclick = () => { form.hidden = !form.hidden; if (!form.hidden) form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  $('#cancel-upload').onclick = () => { form.reset(); previews.innerHTML = ''; form.hidden = true; };
  const renderPreviews = () => { previews.innerHTML = [...input.files].slice(0, 50).map((f) => `<span class="thumb" style="background-image:url('${URL.createObjectURL(f)}')" title="${esc(f.name)}"></span>`).join(''); };
  input.onchange = renderPreviews;
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; renderPreviews(); } });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const files = [...input.files].filter((f) => /^image\//.test(f.type));
    if (!files.length) return msg(form, 'Choose at least one photo.', true);
    if (files.length > 50) return msg(form, 'Please upload up to 50 photos at a time.', true);
    busy(form, true);
    const bar = $('.progress', form); bar.hidden = false;
    let done = 0, failed = 0;
    const now = new Date().toISOString();
    for (const original of files) {
      msg(form, `Uploading ${done + failed + 1} of ${files.length}…`);
      try {
        const file = await prepareImage(original);
        if (file.size > 15 * 1048576) throw new Error(`${original.name} is too large (over 15 MB).`);
        const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        ok(await sb.storage.from('member-photos').upload(path, file, { contentType: file.type, upsert: false }));
        const ins = await sb.from('photo_submissions').insert({
          member_id: me.id, storage_path: path, status: 'approved', reviewed_by: me.id, reviewed_at: now,
          event_name: form.event_name.value.trim() || null, caption: form.caption.value.trim() || null,
          show_in_gallery: form.show_in_gallery.checked
        });
        if (ins.error) { await sb.storage.from('member-photos').remove([path]); throw ins.error; }
        done++;
      } catch (err) { failed++; console.warn(err); }
      $('i', bar).style.width = `${Math.round(((done + failed) / files.length) * 100)}%`;
    }
    busy(form, false);
    if (done) { toast(`Published ${done} photo${done > 1 ? 's' : ''}`); ctx.photoFilter = 'approved'; await show('photos'); }
    if (failed) toast(`${failed} photo${failed > 1 ? 's' : ''} couldn’t be uploaded`, true);
  };
}

/* ---------------------------------------------------------------------
   Directory upload / update (bulk import from CSV or Excel)
--------------------------------------------------------------------- */
const DIR_COLUMNS = [
  ['member_number', 'Member number', 'family'], ['family_name', 'Family name', 'family'],
  ['first_name', 'First name', 'member'], ['last_name', 'Last name', 'member'], ['relationship', 'Relationship', 'member'],
  ['email', 'Email', 'member'], ['mobile_phone', 'Mobile phone', 'member'], ['date_of_birth', 'Date of birth', 'member'],
  ['wedding_date', 'Wedding date', 'member'], ['baptized', 'Baptized', 'member'], ['confirmed', 'Confirmed', 'member'],
  ['directory_opt_in', 'In directory', 'member'],
  ['address_line1', 'Address line 1', 'family'], ['address_line2', 'Address line 2', 'family'], ['city', 'City', 'family'],
  ['state', 'State', 'family'], ['zip', 'ZIP', 'family'], ['home_phone', 'Home phone', 'family'],
  ['prayer_group', 'Prayer group', 'family'], ['home_parish', 'Home parish', 'family'], ['member_since', 'Member since', 'family'],
  ['status', 'Status', 'family']
];
const DATE_FIELDS = new Set(['date_of_birth', 'wedding_date', 'member_since']);
const BOOL_FIELDS = new Set(['baptized', 'confirmed', 'directory_opt_in']);
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HEADER_ALIASES = (() => {
  const m = {};
  DIR_COLUMNS.forEach(([k, label]) => { m[norm(k)] = k; m[norm(label)] = k; });
  Object.assign(m, { 'first': 'first_name', 'firstname': 'first_name', 'given name': 'first_name', 'last': 'last_name', 'lastname': 'last_name', 'surname': 'last_name',
    'family': 'family_name', 'household': 'family_name', 'phone': 'mobile_phone', 'mobile': 'mobile_phone', 'cell': 'mobile_phone', 'cell phone': 'mobile_phone',
    'e mail': 'email', 'email address': 'email', 'dob': 'date_of_birth', 'birthday': 'date_of_birth', 'birth date': 'date_of_birth', 'address': 'address_line1',
    'street': 'address_line1', 'zip code': 'zip', 'postal code': 'zip', 'member no': 'member_number', 'member id': 'member_number', 'area': 'prayer_group',
    'prayer group area': 'prayer_group', 'parish': 'home_parish', 'directory': 'directory_opt_in', 'list in directory': 'directory_opt_in' });
  return m;
})();

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

async function readSheet(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  if (!window.XLSX) {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Couldn’t load the Excel reader. Save the file as CSV and try again.')); document.head.appendChild(s); });
  }
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }).filter((r) => r.some((x) => String(x).trim() !== ''));
}

function validYmd(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function cleanDate(v) {
  if (v === '' || v == null) return null;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return validYmd(y, +m[1], +m[2]); }
  const d = new Date(s);
  return isNaN(d) ? undefined : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const cleanBool = (v) => { const s = norm(v); if (!s) return null; if (['y', 'yes', 'true', '1', 'x'].includes(s)) return true; if (['n', 'no', 'false', '0'].includes(s)) return false; return undefined; };

/** Work out what an upload would change, without saving anything. */
async function planImport(rows) {
  const header = rows[0].map((h) => HEADER_ALIASES[norm(h)] || null);
  const unknown = rows[0].filter((h, i) => String(h).trim() && !header[i]);
  if (!header.includes('first_name') || !header.includes('last_name') || !(header.includes('family_name') || header.includes('member_number'))) {
    throw new Error('The first row must have column headings, including First name, Last name, and Family name (or Member number). Download the template to see the layout.');
  }
  const fams = ok(await sb.from('families').select('*, members(*)'));
  const allMembers = fams.flatMap((f) => f.members.map((m) => ({ ...m, _fam: f })));
  const byNumber = new Map(fams.filter((f) => f.member_number).map((f) => [norm(f.member_number), f]));
  const byName = new Map(fams.map((f) => [norm(f.family_name), f]));
  const byEmail = new Map(allMembers.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m]));

  const famPlans = new Map(); // key -> { existing, values, changes }
  const items = []; const problems = [];
  const famKeyOf = (rec) => rec.member_number ? 'n:' + norm(rec.member_number) : 'f:' + norm(rec.family_name);

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const rec = {};
    header.forEach((k, i) => { if (k) rec[k] = typeof r[i] === 'string' ? r[i].trim() : r[i]; });
    for (const k of DATE_FIELDS) if (k in rec) { const d = cleanDate(rec[k]); if (d === undefined) { problems.push({ line, msg: `“${rec[k]}” isn’t a date I can read (${k.replace(/_/g, ' ')}). Use YYYY-MM-DD or MM/DD/YYYY.` }); rec[k] = null; } else rec[k] = d; }
    for (const k of BOOL_FIELDS) if (k in rec) { const b = cleanBool(rec[k]); rec[k] = b === undefined ? null : b; }
    if (rec.email) rec.email = String(rec.email).toLowerCase();
    if (rec.state) rec.state = String(rec.state).toUpperCase().slice(0, 2);
    if (rec.status) { const s = norm(rec.status); rec.status = ['active', 'inactive', 'visitor'].includes(s) ? s : null; }
    if (!rec.first_name || !rec.last_name) { problems.push({ line, msg: 'Missing first or last name — row skipped.' }); return; }
    if (rec.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) { problems.push({ line, msg: `“${rec.email}” isn’t a valid email — the email was left out.` }); delete rec.email; }

    const existingFam = (rec.member_number && byNumber.get(norm(rec.member_number))) || (rec.family_name && byName.get(norm(rec.family_name))) || null;
    if (!existingFam && !rec.family_name) { problems.push({ line, msg: rec.member_number ? `No family found with member number “${rec.member_number}”, and no family name given — row skipped.` : 'No family name or member number — row skipped.' }); return; }
    // Match the person: same email anywhere, otherwise same name in the same family
    const sameEmail = rec.email && byEmail.get(rec.email);
    let existingMem = null;
    if (sameEmail) {
      if (!existingFam || sameEmail.family_id !== existingFam.id) { problems.push({ line, msg: `${rec.email} already belongs to ${sameEmail.first_name} ${sameEmail.last_name} in another family (${sameEmail._fam.family_name}) — row skipped.` }); return; }
      if (norm(sameEmail.first_name) !== norm(rec.first_name) || norm(sameEmail.last_name) !== norm(rec.last_name)) { problems.push({ line, msg: `${rec.email} belongs to ${sameEmail.first_name} ${sameEmail.last_name}, not ${rec.first_name} ${rec.last_name} — row skipped. Fix the name or email and upload again.` }); return; }
      existingMem = sameEmail;
    } else if (existingFam) {
      existingMem = existingFam.members.find((m) => norm(m.first_name) === norm(rec.first_name) && norm(m.last_name) === norm(rec.last_name)) || null;
    }
    if (rec.email && !existingMem && items.some((it) => it.values && it.values.email === rec.email)) { problems.push({ line, msg: `${rec.email} appears twice in the file — second row skipped.` }); return; }

    const key = existingFam ? 'id:' + existingFam.id : famKeyOf(rec);
    let fp = famPlans.get(key);
    if (!fp) { fp = { existing: existingFam, values: {}, label: existingFam ? existingFam.family_name : rec.family_name }; famPlans.set(key, fp); }
    DIR_COLUMNS.filter(([, , t]) => t === 'family').forEach(([k]) => {
      const v = rec[k];
      if (v === undefined || v === null || v === '') return;
      if (k === 'family_name' && existingFam && rec.member_number && norm(v) !== norm(existingFam.family_name)) { fp.values[k] = v; return; }
      if (fp.values[k] === undefined) fp.values[k] = typeof v === 'number' ? String(v) : v;
    });

    const values = {};
    DIR_COLUMNS.filter(([, , t]) => t === 'member').forEach(([k]) => { const v = rec[k]; if (v !== undefined && v !== null && v !== '') values[k] = typeof v === 'number' ? String(v) : v; });
    if (existingMem && existingMem.auth_user_id && values.email && values.email !== existingMem.email) { problems.push({ line, msg: `${rec.first_name} ${rec.last_name} signs in with ${existingMem.email}; the new email was ignored. Remove portal access first to change it.` }); delete values.email; }
    const changes = existingMem ? Object.keys(values).filter((k) => String(existingMem[k] ?? '') !== String(values[k])) : Object.keys(values);
    if (existingMem && !changes.length) { items.push({ line, kind: 'same', fam: fp, name: `${rec.first_name} ${rec.last_name}` }); return; }
    items.push({ line, kind: existingMem ? 'update' : 'new', fam: fp, existing: existingMem, values: existingMem ? Object.fromEntries(changes.map((k) => [k, values[k]])) : values, changes, name: `${rec.first_name} ${rec.last_name}` });
  });

  famPlans.forEach((fp) => {
    if (!fp.existing) { fp.kind = 'new'; fp.changes = Object.keys(fp.values); return; }
    fp.changes = Object.keys(fp.values).filter((k) => String(fp.existing[k] ?? '') !== String(fp.values[k]));
    fp.kind = fp.changes.length ? 'update' : 'same';
  });
  return { famPlans: [...famPlans.values()], items, problems, unknown, total: rows.length - 1 };
}

const FIELD_LABEL = Object.fromEntries(DIR_COLUMNS.map(([k, l]) => [k, l]));
const shown = (v) => (v === true ? 'Yes' : v === false ? 'No' : v ?? '—');
function planSummary(plan) {
  const f = plan.famPlans, it = plan.items;
  const n = (arr, k) => arr.filter((x) => x.kind === k).length;
  return { newFams: n(f, 'new'), updFams: n(f, 'update'), newMems: n(it, 'new'), updMems: n(it, 'update'), same: n(it, 'same'), problems: plan.problems.length };
}

function renderPlan(plan) {
  const s = planSummary(plan);
  const nothing = !s.newFams && !s.updFams && !s.newMems && !s.updMems;
  const changeRows = [
    ...plan.famPlans.filter((f) => f.kind !== 'same').map((f) => `<tr><td><span class="pill pill--${f.kind === 'new' ? 'both' : 'members'}">${f.kind === 'new' ? 'New family' : 'Family update'}</span></td><td><strong>${esc(f.label)}</strong></td><td class="muted small">${f.changes.map((k) => `${esc(FIELD_LABEL[k] || k)}${f.kind === 'update' ? `: ${esc(shown(f.existing[k]))} → ${esc(shown(f.values[k]))}` : `: ${esc(shown(f.values[k]))}`}`).join('<br>')}</td></tr>`),
    ...plan.items.filter((i) => i.kind !== 'same').map((i) => `<tr><td><span class="pill pill--${i.kind === 'new' ? 'both' : 'members'}">${i.kind === 'new' ? 'New member' : 'Member update'}</span></td><td><strong>${esc(i.name)}</strong><br><small class="muted">${esc(i.fam.label)} · row ${i.line}</small></td><td class="muted small">${i.changes.map((k) => `${esc(FIELD_LABEL[k] || k)}${i.kind === 'update' ? `: ${esc(shown(i.existing[k]))} → ${esc(shown(i.values[k]))}` : `: ${esc(shown(i.values[k]))}`}`).join('<br>') || '—'}</td></tr>`)
  ];
  return `
    <section class="pcard">
      <div class="pcard__head"><div><h2>Review before importing</h2><p class="muted small">${plan.total} row${plan.total === 1 ? '' : 's'} read from <strong>${esc(ctx.dirFileName)}</strong>. Nothing has been saved yet.</p></div>
        <div class="btn-row"><button class="btn btn--outline btn--small" id="dir-cancel">Choose a different file</button>${nothing ? '' : '<button class="btn btn--primary btn--small" id="dir-apply">Import changes</button>'}</div></div>
      <div class="stats stats--compact">
        <div class="stat"><span>New families</span><strong>${s.newFams}</strong></div>
        <div class="stat"><span>Families updated</span><strong>${s.updFams}</strong></div>
        <div class="stat"><span>New members</span><strong>${s.newMems}</strong></div>
        <div class="stat"><span>Members updated</span><strong>${s.updMems}</strong></div>
        <div class="stat"><span>Unchanged</span><strong>${s.same}</strong></div>
        <div class="stat"><span>Problems</span><strong>${s.problems}</strong></div>
      </div>
      ${plan.unknown.length ? `<p class="notice small">These columns weren’t recognised and will be ignored: ${plan.unknown.map(esc).join(', ')}.</p>` : ''}
      ${plan.problems.length ? `<details class="dir-problems" open><summary><strong>${plan.problems.length} row${plan.problems.length === 1 ? '' : 's'} need attention</strong></summary><ul>${plan.problems.map((p) => `<li>Row ${p.line}: ${esc(p.msg)}</li>`).join('')}</ul></details>` : ''}
      ${nothing ? '<p class="empty">Everything in this file already matches the directory — nothing to import.</p>' : `<div class="table-wrap"><table class="table table--compact"><thead><tr><th>Change</th><th>Who</th><th>Details</th></tr></thead><tbody>${changeRows.join('')}</tbody></table></div>`}
      <div class="progress" id="dir-progress" hidden><i></i></div>
      <p class="form__msg" id="dir-msg" role="status"></p>
    </section>`;
}

async function applyPlan(plan) {
  const work = plan.famPlans.filter((f) => f.kind !== 'same').length + plan.items.filter((i) => i.kind !== 'same').length;
  let done = 0, failed = 0; const errs = [];
  const bar = $('#dir-progress'); bar.hidden = false;
  const tick = () => { done++; $('i', bar).style.width = `${Math.round((done / Math.max(1, work)) * 100)}%`; $('#dir-msg').textContent = `Saving ${done} of ${work}…`; };
  for (const fp of plan.famPlans) {
    try {
      if (fp.kind === 'new') {
        const row = ok(await sb.from('families').insert({ status: 'active', ...fp.values }).select('id').single());
        fp.id = row.id; tick();
      } else {
        fp.id = fp.existing.id;
        if (fp.kind === 'update') { ok(await sb.from('families').update({ ...Object.fromEntries(fp.changes.map((k) => [k, fp.values[k]])), updated_at: new Date().toISOString() }).eq('id', fp.id)); tick(); }
      }
    } catch (e) { failed++; errs.push(`${fp.label}: ${friendly(e)}`); tick(); }
  }
  for (const it of plan.items) {
    if (it.kind === 'same') continue;
    try {
      if (!it.fam.id) throw new Error('its family couldn’t be saved');
      if (it.kind === 'new') ok(await sb.from('members').insert({ ...it.values, family_id: it.fam.id }));
      else ok(await sb.from('members').update(it.values).eq('id', it.existing.id));
    } catch (e) { failed++; errs.push(`Row ${it.line} (${it.name}): ${friendly(e)}`); }
    tick();
  }
  return { done: work - failed, failed, errs };
}

async function uploadView() {
  if (ctx.dirPlan) return renderPlan(ctx.dirPlan);
  const [{ count: famCount }, { count: memCount }] = await Promise.all([
    sb.from('families').select('id', { count: 'exact', head: true }),
    sb.from('members').select('id', { count: 'exact', head: true })
  ]);
  return `
    <div class="grid-2">
      <section class="pcard">
        <h2>Bulk upload</h2>
        <p class="muted small">Upload a spreadsheet (Excel or CSV) with one row per person. You’ll see exactly what will change before anything is saved.</p>
        <form id="dir-form" class="form form--flat">
          <label class="drop" id="dir-drop">
            <input type="file" name="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" required>
            <span class="drop__text"><strong>Choose a file</strong> or drag it here<br><small>Excel (.xlsx) or CSV · first row must be column headings</small></span>
          </label>
          <p class="form__msg" role="status"></p>
        </form>
        <h3>How updates work</h3>
        <ul class="small dir-rules">
          <li><strong>Families</strong> are matched by member number, or by family name if there’s no number.</li>
          <li><strong>People</strong> are matched by email, or by first and last name within the family.</li>
          <li>Matching people are <strong>updated</strong>; anyone new is <strong>added</strong>.</li>
          <li><strong>Blank cells never erase</strong> existing information, and nobody is deleted.</li>
          <li>Portal roles and logins are never changed by an upload.</li>
        </ul>
      </section>
      <section class="pcard">
        <h2>Download</h2>
        <p class="muted small">The directory currently has <strong>${famCount ?? 0}</strong> families and <strong>${memCount ?? 0}</strong> members.</p>
        <div class="dl-list">
          <button class="dl" id="dl-current"><strong>Current directory</strong><span>Every family and member in the upload layout — edit it and upload it back to make bulk changes.</span></button>
          <button class="dl" id="dl-template"><strong>Blank template</strong><span>The column headings with two example rows to show the layout.</span></button>
        </div>
        <h3>Columns</h3>
        <p class="small muted">${DIR_COLUMNS.map(([, l]) => l).join(' · ')}</p>
        <p class="small muted">Required: First name, Last name and Family name (or an existing Member number). Dates as YYYY-MM-DD or MM/DD/YYYY; Yes/No for Baptized, Confirmed and In directory.</p>
      </section>
    </div>`;
}

function bindUpload() {
  if (ctx.dirPlan) {
    $('#dir-cancel').onclick = () => { ctx.dirPlan = null; show('members'); };
    const apply = $('#dir-apply');
    if (apply) apply.onclick = () => {
      const s = planSummary(ctx.dirPlan);
      confirmDialog('Import these changes?', `${s.newFams} new families, ${s.updFams} family updates, ${s.newMems} new members and ${s.updMems} member updates will be saved.`, async () => {
        $('#dir-cancel').disabled = true; apply.disabled = true;
        const res = await applyPlan(ctx.dirPlan);
        ctx.dirPlan = null;
        if (res.failed) {
          view.innerHTML = `<section class="pcard"><h2>Import finished with problems</h2><p>${res.done} change${res.done === 1 ? '' : 's'} saved; ${res.failed} couldn’t be saved:</p><ul class="small">${res.errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><button class="btn btn--primary btn--small" id="dir-again">Back to Bulk upload</button></section>`;
          $('#dir-again').onclick = () => show('members');
        } else { toast(`Imported ${res.done} change${res.done === 1 ? '' : 's'}`); ctx.familyId = null; ctx.membersMode = 'directory'; await show('members'); }
      }, 'Import');
    };
    return;
  }
  const form = $('#dir-form'), input = form.file, drop = $('#dir-drop');
  const handle = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1048576) return msg(form, 'That file is larger than 5 MB.', true);
    msg(form, 'Reading the file…');
    try {
      const rows = await readSheet(file);
      if (rows.length < 2) throw new Error('The file has no rows under the headings.');
      if (rows.length > 3001) throw new Error('Please upload 3,000 rows or fewer at a time.');
      ctx.dirFileName = file.name;
      ctx.dirPlan = await planImport(rows);
      await show('members');
    } catch (e) { msg(form, friendly(e), true); input.value = ''; }
  };
  input.onchange = () => handle(input.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); handle(e.dataTransfer.files[0]); });

  const headings = DIR_COLUMNS.map(([, l]) => l);
  const toCsv = (rows) => [headings, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const yn = (b) => (b === true ? 'Yes' : b === false ? 'No' : '');
  $('#dl-template').onclick = () => download('mtca-directory-template.csv', '﻿' + toCsv([
    ['MTCA-0001', 'Thomas, Varghese & Mary', 'Varghese', 'Thomas', 'Head', 'varghese@example.com', '(770) 555-0101', '1971-04-12', '1998-05-23', 'Yes', 'Yes', 'Yes', '123 Example St', '', 'Duluth', 'GA', '30096', '(770) 555-0100', 'North Area', 'Maramon', '2009-08-01', 'active'],
    ['MTCA-0001', 'Thomas, Varghese & Mary', 'Mary', 'Thomas', 'Spouse', 'mary@example.com', '(770) 555-0102', '', '', 'Yes', 'Yes', 'No', '', '', '', '', '', '', '', '', '', '']
  ]));
  $('#dl-current').onclick = async () => {
    const fams = ok(await sb.from('families').select('*, members(*)').order('family_name'));
    const rows = [];
    fams.forEach((f) => {
      const people = f.members.length ? f.members : [{}];
      people.forEach((m) => rows.push(DIR_COLUMNS.map(([k, , t]) => { const src = t === 'family' ? f : m; const v = src[k]; return BOOL_FIELDS.has(k) ? yn(v) : v ?? ''; })));
    });
    download(`mtca-directory-${todayIso()}.csv`, '﻿' + toCsv(rows));
  };
}

/* ---------------------------------------------------------------------
   Routing
--------------------------------------------------------------------- */
async function route() {
  loading.hidden = true;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { authView.hidden = false; appView.hidden = true; return; }
  me = ok(await sb.from('members').select('id, first_name, last_name, role, email').eq('auth_user_id', session.user.id).maybeSingle());
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


/* ---------------------------------------------------------------------
   Worship: upcoming Sundays (officers) + regular pattern (admins)
--------------------------------------------------------------------- */
const longDay = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const ordinal = (n) => ['', '1st', '2nd', '3rd', '4th', '5th'][n];

VIEWS.worship = async function () {
  const weeks = ctx.worshipWeeks || 10;
  const days = nextSundays(weeks);
  const [setRow, changes, lect] = await Promise.all([
    sb.from('portal_settings').select('value').eq('key', 'worship').maybeSingle(),
    sb.from('worship_services').select('*').gte('day', days[0]).lte('day', days[days.length - 1]),
    sb.from('ref_lectionary').select('day, title').gte('day', days[0]).lte('day', days[days.length - 1])
  ]);
  const pattern = { ...WORSHIP_DEFAULT, ...((setRow.data && setRow.data.value) || {}) };
  pattern.schedule = { ...WORSHIP_DEFAULT.schedule, ...(pattern.schedule || {}) };
  ctx.worship = { pattern, days, changes: Object.fromEntries((ok(changes) || []).map((c) => [c.day, c])), lect: Object.fromEntries(((lect.data) || []).map((l) => [l.day, l.title])) };
  const rows = days.map((d) => sundayInfo(d, pattern, ctx.worship.changes[d]));
  const langOpts = ['Malayalam', 'English', 'Bilingual', 'Combined', 'Special'];
  return `
    <section class="pcard">
      <div class="pcard__head"><div><h2>Upcoming Sundays</h2>
        <p class="muted small">Each Sunday follows the regular pattern unless you change it. Changes appear on the Worship page, the “This Sunday” banner and home page, and in Mitra AI’s answers.</p></div></div>
      <div class="table-wrap"><table class="table worship-table">
        <thead><tr><th>Sunday</th><th>Service</th><th>Notes</th><th class="hide-sm">Lectionary</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.changed ? 'is-changed' : ''}${r.lang === 'No service' ? ' is-off' : ''}">
          <td class="nowrap"><strong>${esc(longDay(r.day))}</strong><br><small class="muted">${ordinal(r.nth)} Sunday</small></td>
          <td><span class="pill pill--lang-${esc(r.lang.toLowerCase().replace(/\s+/g, '-'))}">${esc(r.lang)}</span>${r.lang !== 'No service' ? `<br><small class="muted">${esc(fmtTime(r.time))}</small>` : ''}
            ${r.changed ? '<br><span class="badge">Changed</span>' : ''}</td>
          <td>${r.note ? esc(r.note) : '<span class="muted">—</span>'}${r.celebrant ? `<br><small class="muted">${esc(r.celebrant)}</small>` : ''}</td>
          <td class="hide-sm"><small>${esc(lectionaryEnglish(ctx.worship.lect[r.day]) || '—')}</small></td>
          <td class="row-actions"><button class="link-btn" data-wedit="${r.day}">Edit</button>${r.changed ? `<button class="link-btn link-btn--danger" data-wreset="${r.day}">Reset</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p><button class="btn btn--outline btn--small" id="worship-more">Show ${weeks >= 52 ? 'fewer' : 'more'} Sundays</button></p>
    </section>
    <section class="pcard">
      <div class="pcard__head"><div><h2>Regular pattern</h2>
        <p class="muted small">Used for every Sunday you haven’t changed above.${isAdmin() ? '' : ' Only an admin can change it.'}</p></div></div>
      <form id="pattern-form" class="form form--flat">
        <div class="row-3">
          <label>Service time<input type="time" name="time" value="${esc(pattern.time)}" required ${isAdmin() ? '' : 'disabled'}></label>
        </div>
        <div class="row-5">${[1, 2, 3, 4, 5].map((n) => `<label>${ordinal(n)} Sunday<select name="s${n}" ${isAdmin() ? '' : 'disabled'}>${langOpts.map((l) => `<option ${pattern.schedule[n] === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>
        <label>Note for 5th Sundays marked “Special”<input name="fifth_note" value="${esc(pattern.fifth_note || '')}" maxlength="120" ${isAdmin() ? '' : 'disabled'}></label>
        ${isAdmin() ? '<div><button class="btn btn--primary" type="submit">Save pattern</button><p class="form__msg" role="status"></p></div>' : ''}
      </form>
    </section>`;
};

BIND.worship = function () {
  const W = ctx.worship;
  $('#worship-more').onclick = () => { ctx.worshipWeeks = (ctx.worshipWeeks || 10) >= 52 ? 10 : (ctx.worshipWeeks || 10) + 12; show('worship'); };
  $$('[data-wedit]', view).forEach((b) => (b.onclick = () => {
    const day = b.dataset.wedit, c = W.changes[day] || {}, info = sundayInfo(day, W.pattern, null);
    const html = `
      <p class="muted">${esc(longDay(day))} · regularly <strong>${esc(info.regular)}</strong> at ${esc(fmtTime(W.pattern.time))}${W.lect[day] ? `<br>Lectionary: ${esc(lectionaryEnglish(W.lect[day]))}` : ''}</p>
      <div class="row-2">
        <label>Service<select name="language"><option value="">Regular (${esc(info.regular)})</option>${WORSHIP_LANGS.map((l) => `<option ${c.language === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Time<input type="time" name="time" value="${esc((c.time || '').slice(0, 5))}"><small class="muted">Leave blank for the regular ${esc(fmtTime(W.pattern.time))}</small></label>
      </div>
      <label>Note<input name="note" maxlength="160" value="${esc(c.note || '')}" placeholder="e.g. Holy Communion · Episcopal Visit · Harvest Festival after service"></label>
      <label>Celebrant / preacher (optional)<input name="celebrant" maxlength="120" value="${esc(c.celebrant || '')}" placeholder="e.g. Rev. …"></label>`;
    dialog(`Edit ${longDay(day)}`, html, async (v) => {
      const row = { day, language: v.language || null, time: v.time || null, note: (v.note || '').trim() || null, celebrant: (v.celebrant || '').trim() || null, updated_at: new Date().toISOString(), updated_by: me.id };
      if (!row.language && !row.time && !row.note && !row.celebrant) { if (W.changes[day]) ok(await sb.from('worship_services').delete().eq('day', day)); toast('Back to the regular pattern'); }
      else { ok(await sb.from('worship_services').upsert(row, { onConflict: 'day' })); toast('Sunday updated'); }
      await show('worship');
    });
  }));
  $$('[data-wreset]', view).forEach((b) => (b.onclick = () => confirmDialog('Reset this Sunday?', `${esc(longDay(b.dataset.wreset))} will go back to the regular pattern.`, async () => {
    ok(await sb.from('worship_services').delete().eq('day', b.dataset.wreset)); toast('Back to the regular pattern'); await show('worship');
  })));
  const f = $('#pattern-form');
  if (f && isAdmin()) f.onsubmit = async (e) => {
    e.preventDefault(); busy(f, true);
    try {
      const value = { time: f.time.value || '10:00', schedule: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, f[`s${n}`].value])), fifth_note: f.fifth_note.value.trim() };
      ok(await sb.from('portal_settings').upsert({ key: 'worship', value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
      toast('Regular pattern saved'); await show('worship');
    } catch (err) { msg(f, friendly(err), true); } finally { busy(f, false); }
  };
};


/* ---------------------------------------------------------------------
   Newsletters: build from a template (events + announcements) or upload
   a PDF, then email it to members + subscribers (Resend, via the
   newsletter-send function) and list it on the website.
--------------------------------------------------------------------- */
const NL_CHURCH = (window.MTCA && window.MTCA.church) || {};
const NL_SITE_BASE = new URL('../', location.href).href.replace(/\/$/, '');
const NL_SECTION_IDEAS = ['Prayer requests', 'Sunday School', 'Yuvajana Sakhyam', 'Sevika Sangham', 'Youth Fellowship', 'Thank you'];
// The standing notes from the past newsletters; edit them in any issue and the next one starts from there.
const NL_STANDING_NOTES = [
  { heading: '', body: 'For donations & subscriptions make all checks payable to: Mar Thoma Church, Atlanta or MTCA, Church\nEmail: marthomachurchatlanta@gmail.com\nWebsite: https://mtcatlanta.org\nZelle to mtcatrustees@gmail.com' },
  { heading: 'Facility Reservation', body: 'Facility reservation for Organizations and Prayer group activities, please reach out to\nTrustee-Finance: Mr. Santhosh K. Abraham : Email: Skabr22@gmail.com\nTrustee-Accounts: Dr. Robin Thomas : Email: robthomas19@gmail.com\nParish Secretary: Ms. Liz Mathew: Email: liz.ralex@gmail.com\n\nFacility reservation for Baptisms, Marriages and other Sacraments, please reach out to the Vicar Rev. Jacob Thomas at revjacobthomasanikad@gmail.com.' }
];
const ymd = (d) => d.toLocaleDateString('en-CA');
function monthBounds(offset = 1) {
  const n = new Date(), s = new Date(n.getFullYear(), n.getMonth() + offset, 1), e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
  return [ymd(s), ymd(e)];
}
const monthTitle = (day) => new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const sentDay = (iso) => iso ? date(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })) : '';
const nlStatus = (n) => n.status === 'sent' ? `<span class="pill pill--both">Sent ${esc(sentDay(n.sent_at))}</span>`
  : n.status === 'sending' ? '<span class="pill pill--officer">Sending — not finished</span>' : '<span class="pill">Draft</span>';
const parseEmails = (text) => {
  const out = new Map();
  for (const line of String(text).split(/[\n;]+/)) {
    const m = line.match(/[^\s<>,;"']+@[^\s<>,;"']+\.[a-z]{2,}/i);
    if (!m) continue;
    const email = m[0].toLowerCase();
    const name = line.replace(m[0], '').replace(/[<>",]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!out.has(email)) out.set(email, name || null);
  }
  return [...out].map(([email, name]) => ({ email, name }));
};
function churchForPdf() {
  const ch = NL_CHURCH, a = ch.address || {};
  const sender = ctx.nlSender || {};
  return {
    name: ch.name || 'Mar Thoma Church, Atlanta',
    address: sender.church_address || [a.line1, [a.city, a.state].filter(Boolean).join(', ') + (a.zip ? ' ' + a.zip : '')].filter(Boolean).join(', '),
    phone: ch.phone, email: ch.email, livestream: ch.livestream_url,
    website: (window.MTCA && window.MTCA.siteUrl) || 'https://mtcatlanta.org',
    worship_time: (ch.worship && ch.worship.time) || '10:00 AM',
    vicar: (window.MTCA && window.MTCA.vicar) || {}
  };
}
async function nlInvoke(body) {
  const { data, error } = await sb.functions.invoke('newsletter-send', { body: { ...body, site_base: NL_SITE_BASE } });
  if (error) {
    let m = error.message;
    try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) { /* keep message */ }
    throw new Error(m);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

VIEWS.newsletters = async function () {
  if (ctx.nlId) return nlEditorView();
  const [list, subs, outs, mems, setRow] = await Promise.all([
    sb.from('newsletters').select('id, title, source, status, published, sent_at, sent_count, pdf_url, pdf_path, created_at').order('created_at', { ascending: false }),
    sb.from('newsletter_subscribers').select('*').order('created_at', { ascending: false }),
    sb.from('newsletter_optouts').select('*').order('created_at', { ascending: false }),
    sb.from('members').select('id', { count: 'exact', head: true }).not('email', 'is', null),
    sb.from('portal_settings').select('value').eq('key', 'newsletter').maybeSingle()
  ]);
  ctx.nlList = ok(list); ctx.nlSubs = ok(subs); ctx.nlOuts = ok(outs); ctx.nlSender = (setRow.data && setRow.data.value) || {};
  const S = ctx.nlSender, memberCount = mems.count || 0;
  return `
    <section class="pcard">
      <div class="pcard__head"><div><h2>Newsletters</h2>
        <p class="muted small">Create a newsletter from the parish template — it pulls in the events and announcements you’ve already added — or upload a finished PDF. Then email it to the mailing list below. Sent newsletters also appear on the website’s Newsletters page.</p></div>
        <div class="btn-row"><button class="btn btn--primary btn--small" id="nl-new">+ Create from template</button><button class="btn btn--outline btn--small" id="nl-upload">Upload a PDF</button></div></div>
      ${ctx.nlList.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Newsletter</th><th>Status</th><th class="hide-sm">On website</th><th></th></tr></thead>
        <tbody>${ctx.nlList.map((n) => `<tr>
          <td><strong>${esc(n.title)}</strong><br><small class="muted">${n.source === 'upload' ? 'Uploaded PDF' : 'Parish template'}${n.pdf_url ? ` · <a href="${esc(n.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : ' · no PDF yet'}</small></td>
          <td>${nlStatus(n)}${n.status === 'sent' ? `<br><small class="muted">${n.sent_count} ${n.sent_count === 1 ? 'person' : 'people'}</small>` : ''}</td>
          <td class="hide-sm"><label class="check"><input type="checkbox" data-nl-pub="${n.id}" ${n.published ? 'checked' : ''} ${n.pdf_url ? '' : 'disabled'}> Show</label></td>
          <td class="row-actions"><button class="link-btn" data-nl-open="${n.id}">${n.status === 'sent' ? 'View' : 'Open'}</button><button class="link-btn link-btn--danger" data-nl-del="${n.id}">Delete</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">No newsletters yet. Create your first one from the template, or upload a PDF you made elsewhere.</p>'}
    </section>

    <section class="pcard">
      <div class="pcard__head"><div><h2>Mailing list</h2>
        <p class="muted small">Every member with an email in the parish register gets the newsletter automatically (families marked inactive are skipped). Add visitors, friends and anyone else here. Everyone can unsubscribe from the link in each email.</p></div>
        <div class="btn-row"><button class="btn btn--primary btn--small" id="nl-sub-add">+ Add people</button><button class="btn btn--outline btn--small" id="nl-sub-csv">Import CSV</button>${ctx.nlSubs.length ? '<button class="btn btn--outline btn--small" id="nl-sub-export">Download</button>' : ''}</div></div>
      <div class="stat-row">
        <div class="stat"><strong>${memberCount}</strong><span>members with an email</span></div>
        <div class="stat"><strong>${ctx.nlSubs.length}</strong><span>other subscribers</span></div>
        <div class="stat"><strong>${ctx.nlOuts.length}</strong><span>unsubscribed</span></div>
      </div>
      <input type="file" id="nl-csv-file" accept=".csv,text/csv,.txt" hidden>
      ${ctx.nlSubs.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Email</th><th>Name</th><th class="hide-sm">Added</th><th></th></tr></thead>
        <tbody>${ctx.nlSubs.map((s) => `<tr><td>${esc(s.email)}</td><td>${val(s.name)}</td><td class="hide-sm">${date(s.created_at.slice(0, 10))}</td>
          <td class="row-actions"><button class="link-btn link-btn--danger" data-sub-del="${s.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">No extra subscribers yet.</p>'}
      ${ctx.nlOuts.length ? `<details class="nl-optouts"><summary>Unsubscribed (${ctx.nlOuts.length})</summary>
        <p class="muted small">These people clicked “Unsubscribe” and won’t receive newsletters, even if they’re members. Only put someone back if they ask.</p>
        <ul>${ctx.nlOuts.map((o) => `<li>${esc(o.email)} <small class="muted">since ${date(o.created_at.slice(0, 10))}</small> <button class="link-btn" data-out-del="${esc(o.email)}">Put back on the list</button></li>`).join('')}</ul></details>` : ''}
    </section>

    <section class="pcard">
      <h2>Sender</h2>
      <p class="muted small">How the email appears in people’s inboxes.${isAdmin() ? '' : ' Only an admin can change this.'}</p>
      <form id="nl-sender" class="form form--flat">
        <div class="row-3">
          <label>From name<input name="from_name" value="${esc(S.from_name || 'Mar Thoma Church, Atlanta')}" maxlength="80" ${isAdmin() ? '' : 'disabled'}></label>
          <label>From address<input type="email" name="from_email" value="${esc(S.from_email || 'news@mtcatlanta.org')}" ${isAdmin() ? '' : 'disabled'}><small class="muted">Must be on the domain verified in Resend.</small></label>
          <label>Replies go to<input type="email" name="reply_to" value="${esc(S.reply_to || NL_CHURCH.email || '')}" ${isAdmin() ? '' : 'disabled'}></label>
        </div>
        <label>Church address in the email footer<input name="church_address" value="${esc(S.church_address || churchForPdf().address)}" maxlength="160" ${isAdmin() ? '' : 'disabled'}></label>
        ${isAdmin() ? '<div><button class="btn btn--primary btn--small" type="submit">Save sender</button><p class="form__msg" role="status"></p></div>' : ''}
      </form>
    </section>`;
};

BIND.newsletters = function () {
  if (ctx.nlId) return bindNlEditor();
  $('#nl-new').onclick = () => {
    const [s, e] = monthBounds(1);
    dialog('New newsletter', `
      <p class="muted">The newsletter pulls in the events in these dates and the announcements showing at that time. You can pick and edit everything on the next screen.</p>
      <label>Title<input name="title" value="${esc(monthTitle(s))}" required maxlength="80"></label>
      <div class="row-2"><label>Covers from<input type="date" name="period_start" value="${s}" required></label><label>to<input type="date" name="period_end" value="${e}" required></label></div>`,
    async (v) => {
      if (v.period_end < v.period_start) throw new Error('The end date is before the start date.');
      // Carry the standing notes (donations, facility reservation…) over from the last issue
      const prev = (await sb.from('newsletters').select('content').eq('source', 'template').order('created_at', { ascending: false }).limit(1)).data || [];
      const lastSecs = prev[0] && prev[0].content && prev[0].content.sections;
      const content = { message_heading: '', include_sundays: true, include_flyers: true, include_glimpse: true, include_birthdays: true, include_anniversaries: true, attach_pdf: true,
        sections: lastSecs && lastSecs.length ? lastSecs : NL_STANDING_NOTES };
      const row = ok(await sb.from('newsletters').insert({ title: v.title.trim(), period_start: v.period_start, period_end: v.period_end, source: 'template', content, created_by: me.id }).select('id').single());
      ctx.nlId = row.id; await show('newsletters');
    }, { saveLabel: 'Continue' });
  };
  $('#nl-upload').onclick = () => {
    const [s] = monthBounds(0);
    dialog('Upload a newsletter PDF', `
      <label>Title<input name="title" value="${esc(monthTitle(s))}" required maxlength="80"></label>
      <label>PDF file<input type="file" name="file" accept="application/pdf" required><small class="muted">Up to 25 MB. Under 8 MB is also attached to the email.</small></label>
      <label>Short message for the email (optional)<textarea name="message" rows="4" placeholder="Dear friends, the November newsletter is here…"></textarea></label>`,
    async (v, form) => {
      const file = form.file.files[0];
      if (!file || file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
      if (file.size > 25 * 1048576) throw new Error('The PDF must be 25 MB or smaller.');
      const row = ok(await sb.from('newsletters').insert({ title: v.title.trim(), source: 'upload', content: { message: (v.message || '').trim(), attach_pdf: true }, created_by: me.id }).select('id').single());
      await nlUploadPdf(row.id, v.title.trim(), file);
      ctx.nlId = row.id; toast('PDF uploaded'); await show('newsletters');
    }, { saveLabel: 'Upload' });
  };
  $$('[data-nl-open]', view).forEach((b) => (b.onclick = () => { ctx.nlId = b.dataset.nlOpen; show('newsletters'); }));
  $$('[data-nl-pub]', view).forEach((c) => (c.onchange = async () => {
    try { ok(await sb.from('newsletters').update({ published: c.checked }).eq('id', c.dataset.nlPub)); toast(c.checked ? 'Shown on the website' : 'Hidden from the website'); }
    catch (err) { c.checked = !c.checked; toast(friendly(err), true); }
  }));
  $$('[data-nl-del]', view).forEach((b) => (b.onclick = () => {
    const n = ctx.nlList.find((x) => x.id === b.dataset.nlDel);
    confirmDialog('Delete this newsletter?', `“${esc(n.title)}” and its PDF will be removed${n.status === 'sent' ? ', including from the website. People who already received it keep their email' : ''}. This can’t be undone.`, async () => {
      if (n.pdf_path) await sb.storage.from('newsletters').remove([n.pdf_path]).catch(() => {});
      ok(await sb.from('newsletters').delete().eq('id', n.id)); toast('Deleted'); await show('newsletters');
    });
  }));
  // Mailing list
  $('#nl-sub-add').onclick = () => dialog('Add people to the mailing list', `
    <label>Email addresses<textarea name="list" rows="7" required placeholder="mary@example.com&#10;John Varghese <john@example.com>&#10;one per line"></textarea>
    <small class="muted">One per line. A name before or after the address is kept.</small></label>`, async (v) => {
    const rows = parseEmails(v.list);
    if (!rows.length) throw new Error('No email addresses found.');
    await nlAddSubscribers(rows);
  }, { saveLabel: 'Add' });
  const fileIn = $('#nl-csv-file');
  $('#nl-sub-csv').onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const text = await f.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const head = (lines[0] || '').toLowerCase().split(',').map((h) => h.replace(/"/g, '').trim());
      const ei = head.findIndex((h) => /e-?mail/.test(h)), ni = head.findIndex((h) => /^name$|full ?name/.test(h)), fi = head.findIndex((h) => /first/.test(h)), li = head.findIndex((h) => /last|sur/.test(h));
      let rows;
      if (ei >= 0) {
        rows = lines.slice(1).map((l) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim())).map((c) => ({
          email: (c[ei] || '').toLowerCase(), name: ni >= 0 ? c[ni] : [fi >= 0 ? c[fi] : '', li >= 0 ? c[li] : ''].join(' ').trim() || null
        })).filter((r) => /@.+\./.test(r.email));
      } else rows = parseEmails(text);
      if (!rows.length) throw new Error('No email addresses found in that file. It needs a column called “email”.');
      await nlAddSubscribers(rows);
    } catch (err) { toast(friendly(err), true); }
    fileIn.value = '';
  };
  const exp = $('#nl-sub-export');
  if (exp) exp.onclick = () => download(`mtca-newsletter-subscribers-${todayIso()}.csv`, csv(ctx.nlSubs.map(({ email, name, created_at }) => ({ email, name, added: created_at.slice(0, 10) }))));
  $$('[data-sub-del]', view).forEach((b) => (b.onclick = () => {
    const s = ctx.nlSubs.find((x) => x.id === b.dataset.subDel);
    confirmDialog('Remove from the mailing list?', `${esc(s.email)} won’t get future newsletters (unless they’re also a member with this email).`, async () => {
      ok(await sb.from('newsletter_subscribers').delete().eq('id', s.id)); toast('Removed'); await show('newsletters');
    }, 'Remove');
  }));
  $$('[data-out-del]', view).forEach((b) => (b.onclick = () => confirmDialog('Put back on the list?', `Only do this if ${esc(b.dataset.outDel)} asked to receive newsletters again.`, async () => {
    ok(await sb.from('newsletter_optouts').delete().eq('email', b.dataset.outDel)); toast('Back on the list'); await show('newsletters');
  }, 'Put back')));
  const sf = $('#nl-sender');
  if (sf && isAdmin()) sf.onsubmit = async (e) => {
    e.preventDefault(); busy(sf, true);
    try {
      const value = { ...ctx.nlSender, from_name: sf.from_name.value.trim(), from_email: sf.from_email.value.trim().toLowerCase(), reply_to: sf.reply_to.value.trim(), church_address: sf.church_address.value.trim() };
      ok(await sb.from('portal_settings').upsert({ key: 'newsletter', value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
      toast('Sender saved'); await show('newsletters');
    } catch (err) { msg(sf, friendly(err), true); } finally { busy(sf, false); }
  };
};

async function nlAddSubscribers(rows) {
  const existing = new Set(ctx.nlSubs.map((s) => s.email.toLowerCase()));
  const fresh = rows.filter((r) => !existing.has(r.email));
  if (fresh.length) ok(await sb.from('newsletter_subscribers').upsert(fresh.map((r) => ({ email: r.email, name: r.name || null, source: 'admin' })), { onConflict: 'email', ignoreDuplicates: true }));
  const skipped = rows.length - fresh.length;
  toast(`${fresh.length} added${skipped ? `, ${skipped} already on the list` : ''}`);
  await show('newsletters');
}

async function nlUploadPdf(id, title, blob) {
  const old = ctx.nlRow && ctx.nlRow.id === id ? ctx.nlRow.pdf_path : null;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'newsletter';
  const path = `${new Date().getFullYear()}/${slug}-${Date.now()}.pdf`;
  ok(await sb.storage.from('newsletters').upload(path, blob, { contentType: 'application/pdf', cacheControl: '3600' }));
  const url = sb.storage.from('newsletters').getPublicUrl(path).data.publicUrl;
  ok(await sb.from('newsletters').update({ pdf_path: path, pdf_url: url, updated_at: new Date().toISOString() }).eq('id', id));
  if (old && old !== path) await sb.storage.from('newsletters').remove([old]).catch(() => {});
  return url;
}

/* ---------- Editor ---------- */
async function nlEditorView() {
  const nl = ok(await sb.from('newsletters').select('*').eq('id', ctx.nlId).maybeSingle());
  if (!nl) { ctx.nlId = null; return VIEWS.newsletters(); }
  ctx.nlRow = nl;
  if (!ctx.nlSender) { const r = await sb.from('portal_settings').select('value').eq('key', 'newsletter').maybeSingle(); ctx.nlSender = (r.data && r.data.value) || {}; }
  const c = nl.content || {};
  const sent = nl.status !== 'draft';
  let body = '';
  if (nl.source === 'template') {
    const s = nl.period_start, e = nl.period_end;
    const glimpseFrom = (() => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - 45); return ymd(d); })();
    const [er, ar, wr, ws, lr, mr, pr] = await Promise.all([
      sb.from('events').select('*').eq('published', true).gte('starts_at', new Date(s + 'T00:00:00').toISOString()).lte('starts_at', new Date(e + 'T23:59:59').toISOString()).order('starts_at'),
      sb.from('member_announcements').select('*').lte('published_on', e).or(`expires_on.is.null,expires_on.gte.${s}`).order('pinned', { ascending: false }).order('published_on', { ascending: false }),
      sb.from('portal_settings').select('value').eq('key', 'worship').maybeSingle(),
      sb.from('worship_services').select('*').gte('day', s).lte('day', e),
      sb.from('ref_lectionary').select('day, title, lessons, epistle_gospel').gte('day', s).lte('day', e),
      sb.from('members').select('id, first_name, last_name, date_of_birth, wedding_date, family_id, relationship, status, family:families(status)'),
      sb.from('photo_submissions').select('id, storage_path, caption, event_name, created_at').eq('status', 'approved').gte('created_at', new Date(glimpseFrom + 'T00:00:00').toISOString()).order('created_at', { ascending: false }).limit(60)
    ]);
    const pattern = { ...WORSHIP_DEFAULT, ...((wr.data && wr.data.value) || {}) };
    pattern.schedule = { ...WORSHIP_DEFAULT.schedule, ...(pattern.schedule || {}) };
    const changes = Object.fromEntries((ok(ws) || []).map((x) => [x.day, x]));
    const lect = Object.fromEntries(((lr.data) || []).map((x) => [x.day, x]));
    const extra = c.sunday_extra || {};
    const sundays = [];
    for (let d = new Date(s + 'T12:00:00'); ymd(d) <= e; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0) continue;
      const day = ymd(d), info = sundayInfo(day, pattern, changes[day]), L = lect[day] || {};
      const [lesson1, lesson2] = String(L.lessons || '').split(';').map((x) => x.trim());
      const [epistle, gospel] = String(L.epistle_gospel || '').split(';').map((x) => x.trim());
      const lectDay = lectionaryEnglish(L.title).split(' · ')[0] || '';
      const x = extra[day] || {};
      sundays.push({
        day, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        date_long: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        lang: info.lang === 'Special' ? 'Special service' : info.lang, time: fmtTime(info.time),
        lesson1: lesson1 || '', lesson2: lesson2 || '', epistle: epistle || '', gospel: gospel || '',
        default_special: info.note || lectDay, lect_title: lectDay,
        service: x.service ?? 'Holy Communion', special: x.special ?? (info.note || lectDay), support: x.support ?? ''
      });
    }
    // Birthdays & anniversaries from the register (editable text)
    const inPeriod = (md) => { const months = new Set(); for (let d = new Date(s + 'T12:00:00'); ymd(d) <= e; d.setDate(d.getDate() + 1)) months.add(ymd(d).slice(5)); return months.has(md); };
    const active = (ok(mr) || []).filter((m) => (!m.family || m.family.status !== 'inactive') && (m.status || 'active') === 'active');
    const byDay = (list) => { const g = {}; list.forEach(([day, name]) => (g[day] ||= []).push(name)); return Object.keys(g).map(Number).sort((a, b) => a - b).map((d) => `${d}: ${g[d].join('; ')}`).join('\n'); };
    const bdays = active.filter((m) => m.date_of_birth && inPeriod(m.date_of_birth.slice(5))).sort((a, b) => a.date_of_birth.slice(5).localeCompare(b.date_of_birth.slice(5)))
      .map((m) => [Number(m.date_of_birth.slice(8, 10)), `${m.first_name} ${m.last_name}`]);
    const order = { Head: 0, Spouse: 1 };
    const couples = {};
    active.filter((m) => m.wedding_date && inPeriod(m.wedding_date.slice(5))).forEach((m) => { (couples[`${m.family_id}|${m.wedding_date}`] ||= []).push(m); });
    const annis = Object.values(couples).map((ms) => { ms.sort((a, b) => (order[a.relationship] ?? 2) - (order[b.relationship] ?? 2)); return [Number(ms[0].wedding_date.slice(8, 10)), ms.map((m) => `${m.first_name} ${m.last_name}`).join(' & ')]; });
    ctx.nlRegister = { birthdays: byDay(bdays), anniversaries: byDay(annis), bcount: bdays.length, acount: annis.length };
    // Photos for "Quick Glimpse"
    const photos = ok(pr) || [];
    ctx.nlPhotoUrls = {};
    if (photos.length) {
      const signed = ok(await sb.storage.from('member-photos').createSignedUrls(photos.map((p) => p.storage_path), 3600));
      signed.forEach((x, i) => { if (x.signedUrl) ctx.nlPhotoUrls[photos[i].storage_path] = x.signedUrl; });
    }
    const prevMonth = new Date(s + 'T12:00:00'); prevMonth.setMonth(prevMonth.getMonth() - 1);
    const glimpseDefault = `Quick Glimpse of ${prevMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    ctx.nlCand = { events: ok(er), anns: ok(ar), sundays };
    const evIds = c.event_ids || ctx.nlCand.events.filter((x) => !x.members_only).map((x) => x.id);
    const anIds = c.announcement_ids || ctx.nlCand.anns.map((x) => x.id);
    const picked = new Set(c.glimpse_paths || []);
    const evList = ctx.nlCand.events.length ? ctx.nlCand.events.map((x) => `<label class="nl-pick"><input type="checkbox" name="ev" value="${x.id}" ${evIds.includes(x.id) ? 'checked' : ''}>
        <span><strong>${esc(x.title)}</strong>${x.members_only ? ' <span class="badge">Members only</span>' : ''}<br><small class="muted">${esc(eventWhen(x))}${x.location ? ' · ' + esc(x.location) : ''}${x.flyer_url ? ' · has flyer' : ''}</small></span></label>`).join('')
      : `<p class="empty">No published events between ${date(s)} and ${date(e)}. Add them under <a href="#events" data-goto="events">Events</a>, then come back.</p>`;
    const anList = ctx.nlCand.anns.length ? ctx.nlCand.anns.map((x) => `<label class="nl-pick"><input type="checkbox" name="an" value="${x.id}" ${anIds.includes(x.id) ? 'checked' : ''}>
        <span><strong>${esc(x.title)}</strong> <span class="pill pill--${x.audience}">${esc(AUDIENCE[x.audience] || x.audience)}</span><br><small class="muted clamp">${esc(x.body)}</small></span></label>`).join('')
      : `<p class="empty">No announcements showing in these dates. Add them under <a href="#announcements" data-goto="announcements">Announcements</a>.</p>`;
    const sundayRows = sundays.length ? `<div class="table-wrap"><table class="table nl-sundays">
        <thead><tr><th>Sunday</th><th>Service</th><th>Special day / note</th><th>Service support</th></tr></thead>
        <tbody>${sundays.map((x) => `<tr data-day="${x.day}">
          <td class="nowrap"><strong>${esc(x.label)}</strong><br><small class="muted">${esc(x.lang)} · ${esc(x.time)}</small>${x.lesson1 ? `<br><small class="muted" title="${esc([x.lesson1, x.lesson2, x.epistle, x.gospel].join(' · '))}">Lectionary ✓</small>` : '<br><small class="warn">No lectionary</small>'}</td>
          <td><input name="sun_service" value="${esc(x.service)}" maxlength="60" aria-label="Service for ${esc(x.label)}"></td>
          <td><input name="sun_special" value="${esc(x.special)}" maxlength="120" aria-label="Special day for ${esc(x.label)}" placeholder="${esc(x.lect_title)}"></td>
          <td><input name="sun_support" value="${esc(x.support)}" maxlength="80" aria-label="Service support for ${esc(x.label)}" placeholder="e.g. Sevika Sangham"></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No Sundays in these dates.</p>';
    const photoGrid = photos.length ? `<div class="nl-photos">${photos.filter((p) => ctx.nlPhotoUrls[p.storage_path]).map((p) => `<label class="nl-photo"><input type="checkbox" name="gp" value="${esc(p.storage_path)}" ${picked.has(p.storage_path) ? 'checked' : ''}><img src="${esc(ctx.nlPhotoUrls[p.storage_path])}" alt="${esc(p.caption || p.event_name || 'Photo')}" loading="lazy"><small>${esc(p.event_name || p.caption || date(p.created_at.slice(0, 10)))}</small></label>`).join('')}</div>`
      : `<p class="empty">No approved photos from the last few weeks. Add some under <a href="#photos" data-goto="photos">Photos</a> (members’ uploads or your own), then come back.</p>`;
    const sections = c.sections && c.sections.length ? c.sections : [];
    const coverSrc = c.cover_url || new URL('../assets/newsletter/church.jpg', location.href).href;
    body = `
    <section class="pcard">
      <h2>1. What goes in it</h2>
      <p class="muted small">Laid out like the parish’s monthly newsletters: cover and letter, the SUNDAY lectionary table, the calendar, notes to remember, birthdays and anniversaries, flyer pages and a photo glimpse of last month. Leave anything out by unticking it.</p>
      <form id="nl-form" class="form form--flat">
        <div class="row-3">
          <label>Title<input name="title" value="${esc(nl.title)}" required maxlength="80"></label>
          <label>Covers from<input type="date" name="period_start" value="${esc(s)}" required></label>
          <label>to<input type="date" name="period_end" value="${esc(e)}" required></label>
        </div>

        <h3 class="nl-h">Cover & letter</h3>
        <div class="nl-cover">
          <img src="${esc(coverSrc)}" alt="Cover photo" id="nl-cover-img">
          <div>
            <label>Cover photo<input type="file" name="cover_file" accept="image/jpeg,image/png,image/webp"><small class="muted">A wide photo works best. Leave empty to keep ${c.cover_url ? 'this one' : 'the church photo'}.</small></label>
            ${c.cover_url ? '<label class="check"><input type="checkbox" name="cover_reset"> Go back to the church photo</label>' : ''}
          </div>
        </div>
        <label>Letter<textarea name="message" rows="10">${esc(c.message ?? 'Dearly beloved in Christ,\n\n')}</textarea><small class="muted">Opens the newsletter and the email. Leave a blank line between paragraphs. Malayalam works too.</small></label>
        <label>Signed<textarea name="signoff" rows="3">${esc(c.signoff ?? `Yours in Christ’s service,\n${((window.MTCA && window.MTCA.vicar) || {}).name || 'Rev. …'}\nVicar`)}</textarea></label>
        <label>Heading above the letter (optional)<input name="message_heading" value="${esc(c.message_heading || '')}" maxlength="80"></label>

        <h3 class="nl-h"><label class="check"><input type="checkbox" name="include_sundays" ${c.include_sundays !== false ? 'checked' : ''}> SUNDAY page</label> <small class="muted">${sundays.length} Sundays · times and languages from the Worship page, readings from the lectionary</small></h3>
        ${sundayRows}
        <label>Note under the table (optional)<textarea name="sunday_note" rows="2" placeholder="e.g. Sunday School is on break this month.">${esc(c.sunday_note || '')}</textarea></label>

        <h3 class="nl-h">Calendar <small class="muted">${ctx.nlCand.events.length} events in these dates</small></h3>
        <div class="nl-picks">${evList}</div>

        <h3 class="nl-h">A Few Notes To Remember <small class="muted">announcements ${ctx.nlCand.anns.length ? `(${ctx.nlCand.anns.length} showing)` : ''}, then the notes below</small></h3>
        <div class="nl-picks">${anList}</div>
        <div id="nl-sections">${sections.map(nlSectionHtml).join('')}</div>
        <div class="chip-row"><span class="muted small">Add:</span>${NL_SECTION_IDEAS.map((t) => `<button type="button" class="nl-chip" data-add-sec="${esc(t)}">${esc(t)}</button>`).join('')}<button type="button" class="nl-chip" data-add-sec="">Other…</button></div>

        <h3 class="nl-h">Birthdays & anniversaries <small class="muted">from the parish register — edit freely</small></h3>
        <p class="muted small">One day per line, names separated by “;”. The newsletter is also posted on the website, so take out anyone who prefers not to be listed.</p>
        <div class="row-2">
          <label><span><input type="checkbox" name="include_birthdays" ${c.include_birthdays !== false ? 'checked' : ''}> Birthdays <small class="muted">(${ctx.nlRegister.bcount} in the register)</small></span><textarea name="birthdays" rows="8" placeholder="1: Mathew Varghese; Manu Jacob George&#10;2: Aidan Abraham Cherian">${esc(c.birthdays_text ?? ctx.nlRegister.birthdays)}</textarea></label>
          <label><span><input type="checkbox" name="include_anniversaries" ${c.include_anniversaries !== false ? 'checked' : ''}> Anniversaries <small class="muted">(${ctx.nlRegister.acount} in the register)</small></span><textarea name="anniversaries" rows="8" placeholder="2: Johnson Yohannan &amp; Mariamma Johnson">${esc(c.anniversaries_text ?? ctx.nlRegister.anniversaries)}</textarea></label>
        </div>
        <p><button type="button" class="link-btn" id="nl-refill">Refill both from the register</button></p>

        <h3 class="nl-h"><label class="check"><input type="checkbox" name="include_flyers" ${c.include_flyers !== false ? 'checked' : ''}> Flyer pages</label> <small class="muted">full-size flyers of the chosen events and announcements</small></h3>

        <h3 class="nl-h"><label class="check"><input type="checkbox" name="include_glimpse" ${c.include_glimpse !== false ? 'checked' : ''}> Quick Glimpse</label> <small class="muted">photos from recent weeks</small></h3>
        <div class="row-2">
          <label>Page title<input name="glimpse_title" value="${esc(c.glimpse_title || glimpseDefault)}" maxlength="80"></label>
          <label>Subtitle (optional)<input name="glimpse_subtitle" value="${esc(c.glimpse_subtitle || '')}" maxlength="80" placeholder="e.g. Onam 2026"></label>
        </div>
        ${photoGrid}

        <div class="nl-opts">
          <label class="check"><input type="checkbox" name="attach_pdf" ${c.attach_pdf !== false ? 'checked' : ''}> Attach the PDF to the email (as well as a link)</label>
        </div>
        <div class="nl-actions">
          <button class="btn btn--outline" type="submit">Save draft</button>
          <button class="btn btn--outline" type="button" id="nl-preview">Preview PDF</button>
          <button class="btn btn--primary" type="button" id="nl-build">${nl.pdf_url ? 'Update the PDF' : 'Create the PDF'}</button>
          <p class="form__msg" role="status"></p>
        </div>
      </form>
    </section>`;
  } else {
    body = `
    <section class="pcard">
      <h2>1. Newsletter</h2>
      <form id="nl-form" class="form form--flat">
        <label>Title<input name="title" value="${esc(nl.title)}" required maxlength="80"></label>
        <label>Short message for the email<textarea name="message" rows="5" placeholder="Dear friends, the newsletter is attached…">${esc(c.message || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="attach_pdf" ${c.attach_pdf !== false ? 'checked' : ''}> Attach the PDF to the email (as well as a link)</label>
        <label>Replace the PDF (optional)<input type="file" name="file" accept="application/pdf"></label>
        <div class="nl-actions"><button class="btn btn--primary" type="submit">Save</button><p class="form__msg" role="status"></p></div>
      </form>
    </section>`;
  }
  const stale = nl.source === 'template' && c.pdf_stale;
  return `
    <p><button class="link-btn" id="nl-back">← All newsletters</button></p>
    <div class="nl-titlebar"><h2>${esc(nl.title)}</h2>${nlStatus(nl)}</div>
    ${sent ? `<div class="notice">This newsletter has been sent. Changes you save here update the PDF on the website, but people who already got the email keep the version they received.</div>` : ''}
    ${body}
    <section class="pcard" id="nl-send-card">
      <h2>2. Send</h2>
      <div class="nl-pdf">${nl.pdf_url
        ? `<a class="btn btn--outline btn--small" href="${esc(nl.pdf_url)}" target="_blank" rel="noopener">Open the PDF</a> <span class="muted small">${stale ? '<strong class="warn">You’ve changed the contents since this PDF was made — update the PDF before sending.</strong>' : 'This is exactly what people will get.'}</span>`
        : `<p class="muted">${nl.source === 'template' ? 'Create the PDF above first.' : 'Upload the PDF first.'}</p>`}</div>
      <div id="nl-stats" class="muted small">Counting recipients…</div>
      <div class="nl-send-grid">
        <form id="nl-test" class="form form--flat nl-test">
          <label>Send a test to<input type="email" name="to" value="${esc(me.email || '')}" required></label>
          <button class="btn btn--outline btn--small" type="submit" ${nl.pdf_url ? '' : 'disabled'}>Send test</button>
          <p class="form__msg" role="status"></p>
        </form>
        <div class="nl-go">
          <button class="btn btn--gold" id="nl-send" disabled>Send to everyone</button>
          <div class="progress" id="nl-progress" hidden><i></i></div>
          <p class="small" id="nl-send-msg" role="status"></p>
        </div>
      </div>
    </section>`;
}

const nlSectionHtml = (sec = {}) => `<fieldset class="nl-sec">
  <div class="nl-sec__head"><input name="sec_heading" value="${esc(sec.heading || '')}" placeholder="Section heading" maxlength="80" aria-label="Section heading"><button type="button" class="link-btn link-btn--danger" data-sec-del>Remove</button></div>
  <textarea name="sec_body" rows="${Math.min(14, Math.max(4, String(sec.body || '').split('\n').length + 1))}" placeholder="Text for this section" aria-label="Section text">${esc(sec.body || '')}</textarea></fieldset>`;

/** "1: Name; Name" lines → [{day, names}] */
const parsePeople = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = l.match(/^(\d{1,2})\s*[:.\-–]\s*(.+)$/);
  return m ? { day: Number(m[1]), names: m[2].split(';').map((x) => x.trim()).filter(Boolean) } : { day: '', names: [l] };
}).filter((x) => x.names.length);

/** Read the editor into a content object, with copies of the chosen events/announcements. */
function nlCollect(form) {
  const nl = ctx.nlRow, c = { ...(nl.content || {}) };
  if (nl.source === 'upload') {
    return { title: form.title.value.trim(), content: { ...c, message: form.message.value.trim(), attach_pdf: form.attach_pdf.checked } };
  }
  const evIds = $$('input[name=ev]:checked', form).map((i) => i.value);
  const anIds = $$('input[name=an]:checked', form).map((i) => i.value);
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
  const events = ctx.nlCand.events.filter((x) => evIds.includes(x.id)).map((x) => ({ ...pick(x, ['id', 'title', 'starts_at', 'ends_at', 'all_day', 'location', 'description', 'link_url']), flyer_url: x.flyer_url ? mediaUrl(x.flyer_url) : null, when: eventWhen(x) }));
  const announcements = ctx.nlCand.anns.filter((x) => anIds.includes(x.id)).map((x) => ({ ...pick(x, ['id', 'title', 'body', 'link_url']), flyer_url: x.flyer_url ? mediaUrl(x.flyer_url) : null }));
  const heads = $$('[name=sec_heading]', form), bodies = $$('[name=sec_body]', form);
  const sections = heads.map((h, i) => ({ heading: h.value.trim(), body: bodies[i].value.trim() })).filter((x) => x.heading || x.body);
  const sunday_extra = {};
  const sundays = ctx.nlCand.sundays.map((x) => {
    const row = $(`tr[data-day="${x.day}"]`, form);
    const v = (n) => (row ? $(`[name=${n}]`, row).value.trim() : '');
    sunday_extra[x.day] = { service: v('sun_service'), special: v('sun_special'), support: v('sun_support') };
    return { ...x, ...sunday_extra[x.day] };
  });
  const glimpse_paths = $$('input[name=gp]:checked', form).map((i) => i.value);
  Object.assign(c, {
    message_heading: form.message_heading.value.trim(), message: form.message.value.trim(), signoff: form.signoff.value.trim(),
    include_sundays: form.include_sundays.checked, include_flyers: form.include_flyers.checked, attach_pdf: form.attach_pdf.checked,
    include_birthdays: form.include_birthdays.checked, include_anniversaries: form.include_anniversaries.checked, include_glimpse: form.include_glimpse.checked,
    event_ids: evIds, announcement_ids: anIds, events, announcements, sections, sunday_extra,
    sunday_note: form.sunday_note.value.trim(),
    sundays: form.include_sundays.checked ? sundays : [],
    birthdays_text: form.birthdays.value, anniversaries_text: form.anniversaries.value,
    birthdays: form.include_birthdays.checked ? parsePeople(form.birthdays.value) : [],
    anniversaries: form.include_anniversaries.checked ? parsePeople(form.anniversaries.value) : [],
    people_month: new Date(form.period_start.value + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' }),
    glimpse_title: form.glimpse_title.value.trim(), glimpse_subtitle: form.glimpse_subtitle.value.trim(), glimpse_paths,
    glimpse_photos: form.include_glimpse.checked ? glimpse_paths.filter((p) => ctx.nlPhotoUrls[p]).map((p) => ({ path: p, url: ctx.nlPhotoUrls[p] })) : []
  });
  if (form.cover_reset && form.cover_reset.checked) c.cover_url = null;
  return { title: form.title.value.trim(), period_start: form.period_start.value, period_end: form.period_end.value, content: c };
}

/** Upload a new cover photo (if one was chosen) to the public flyers bucket. */
async function nlSaveCover(form, d) {
  const file = form.cover_file && form.cover_file.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) throw new Error('The cover must be a photo (JPG or PNG).');
  const img = await prepareImage(file, 2000, 0.85);
  const path = `newsletter-covers/${Date.now()}-${img.name.replace(/[^\w.\-]+/g, '-').toLowerCase()}`;
  ok(await sb.storage.from('flyers').upload(path, img, { contentType: img.type || 'image/jpeg', cacheControl: '31536000' }));
  d.content.cover_url = sb.storage.from('flyers').getPublicUrl(path).data.publicUrl;
  form.cover_file.value = '';
}

function bindNlEditor() {
  const nl = ctx.nlRow, form = $('#nl-form');
  $('#nl-back').onclick = () => { ctx.nlId = null; show('newsletters'); };
  $$('[data-goto]', view).forEach((a) => (a.onclick = (e) => { e.preventDefault(); ctx.nlId = null; show(a.dataset.goto); }));
  let dirty = false;
  form.addEventListener('input', () => (dirty = true));

  async function save({ quiet = false, rebuilt = false } = {}) {
    const d = nlCollect(form);
    if (!d.title) throw new Error('Give the newsletter a title.');
    if (nl.source === 'template') await nlSaveCover(form, d);
    if (d.period_end && d.period_end < d.period_start) throw new Error('The end date is before the start date.');
    if (nl.source === 'template') d.content.pdf_stale = rebuilt ? false : !!(nl.pdf_url && (dirty || nl.content.pdf_stale));
    ok(await sb.from('newsletters').update({ ...d, updated_at: new Date().toISOString() }).eq('id', nl.id));
    const datesChanged = nl.source === 'template' && (d.period_start !== nl.period_start || d.period_end !== nl.period_end);
    Object.assign(nl, d); dirty = false;
    if (!quiet) toast(datesChanged ? 'Saved — showing events for the new dates' : 'Saved');
    return datesChanged;
  }

  if (nl.source === 'template') {
    $('#nl-refill').onclick = () => { form.birthdays.value = ctx.nlRegister.birthdays; form.anniversaries.value = ctx.nlRegister.anniversaries; dirty = true; form.dispatchEvent(new Event('input')); };
    form.cover_file.onchange = () => { const f = form.cover_file.files[0]; if (f) $('#nl-cover-img').src = URL.createObjectURL(f); };
    const secs = $('#nl-sections');
    const wireSec = () => $$('[data-sec-del]', secs).forEach((b) => (b.onclick = () => { b.closest('.nl-sec').remove(); dirty = true; }));
    wireSec();
    $$('[data-add-sec]', view).forEach((b) => (b.onclick = () => {
      secs.insertAdjacentHTML('beforeend', nlSectionHtml({ heading: b.dataset.addSec }));
      wireSec(); dirty = true;
      const last = secs.lastElementChild; $(b.dataset.addSec ? 'textarea' : 'input', last).focus();
    }));
    form.onsubmit = async (e) => {
      e.preventDefault(); busy(form, true);
      try { const moved = await save(); if (moved) await show('newsletters'); else await refreshSendCard(); }
      catch (err) { msg(form, friendly(err), true); } finally { busy(form, false); }
    };
    $('#nl-preview').onclick = async () => {
      const win = window.open('', '_blank');
      busy(form, true); msg(form, 'Making the preview…');
      try {
        const d = nlCollect(form);
        const f = form.cover_file.files[0];
        if (f) d.content.cover_url = URL.createObjectURL(f);
        const blob = await buildNewsletterPdf({ title: d.title, content: d.content }, churchForPdf());
        const url = URL.createObjectURL(blob);
        if (win) win.location.href = url; else location.href = url;
        msg(form, '');
      } catch (err) { if (win) win.close(); msg(form, friendly(err), true); } finally { busy(form, false); }
    };
    $('#nl-build').onclick = async () => {
      busy(form, true); msg(form, 'Creating the PDF…');
      try {
        const moved = await save({ quiet: true, rebuilt: true });
        if (moved) { msg(form, ''); toast('The dates changed — check the events, then create the PDF again'); await show('newsletters'); return; }
        const blob = await buildNewsletterPdf({ title: nl.title, content: nl.content }, churchForPdf());
        await nlUploadPdf(nl.id, nl.title, blob);
        toast('PDF ready'); await show('newsletters');
      } catch (err) { msg(form, friendly(err), true); } finally { busy(form, false); }
    };
  } else {
    form.onsubmit = async (e) => {
      e.preventDefault(); busy(form, true);
      try {
        await save({ quiet: true });
        const f = form.file.files[0];
        if (f) {
          if (f.type !== 'application/pdf') throw new Error('Choose a PDF file.');
          if (f.size > 25 * 1048576) throw new Error('The PDF must be 25 MB or smaller.');
          await nlUploadPdf(nl.id, nl.title, f);
        }
        toast('Saved'); await show('newsletters');
      } catch (err) { msg(form, friendly(err), true); } finally { busy(form, false); }
    };
  }

  // ---- Sending ----
  const testForm = $('#nl-test');
  testForm.onsubmit = async (e) => {
    e.preventDefault();
    if (dirty) { msg(testForm, 'Save your changes first.', true); return; }
    busy(testForm, true); msg(testForm, 'Sending…');
    try { const r = await nlInvoke({ action: 'test', newsletter_id: nl.id, test_email: testForm.to.value.trim() }); msg(testForm, r.message); }
    catch (err) { msg(testForm, friendly(err), true); } finally { busy(testForm, false); }
  };
  const sendBtn = $('#nl-send'), bar = $('#nl-progress'), out = $('#nl-send-msg');
  let stats = null;
  async function refreshSendCard() {
    try {
      stats = await nlInvoke({ action: 'stats', newsletter_id: nl.id });
      const parts = [`${stats.members} member${stats.members === 1 ? '' : 's'}`, `${stats.subscribers} subscriber${stats.subscribers === 1 ? '' : 's'}`];
      $('#nl-stats').innerHTML = `Goes to <strong>${stats.total}</strong> ${stats.total === 1 ? 'person' : 'people'} (${parts.join(' + ')})${stats.opted_out ? `; ${stats.opted_out} ${stats.opted_out === 1 ? 'person who unsubscribed is' : 'people who unsubscribed are'} skipped` : ''}.`
        + (stats.sent ? ` <strong>Already sent to ${stats.sent}.</strong>` : '')
        + (stats.failed ? ` <span class="warn">${stats.failed} couldn’t be delivered.</span>` : '')
        + (!stats.ready ? '<br><span class="warn">Email sending isn’t switched on yet (the Resend key hasn’t been added in Supabase). You can still create the PDF.</span>' : '');
      const stale = nl.source === 'template' && nl.content.pdf_stale;
      if (!dirty) out.textContent = '';
      const left = stats.remaining - (stats.failed || 0);
      if (stats.failed && left <= 0) { sendBtn.textContent = `Try the ${stats.failed} that failed again`; sendBtn.dataset.retry = '1'; }
      else { sendBtn.textContent = stats.sent ? `Send to the ${left} not sent yet` : `Send to all ${stats.total}`; delete sendBtn.dataset.retry; }
      sendBtn.disabled = !nl.pdf_url || stale || !stats.ready || dirty || (left <= 0 && !stats.failed) || !stats.total;
      if (stats.sent && left <= 0 && !stats.failed) sendBtn.textContent = 'Sent to everyone';
    } catch (err) { $('#nl-stats').innerHTML = `<span class="warn">${esc(friendly(err))}</span>`; }
  }
  form.addEventListener('input', () => { sendBtn.disabled = true; out.textContent = 'Save your changes before sending.'; });
  sendBtn.onclick = () => {
    const retry = !!sendBtn.dataset.retry;
    const n = retry ? stats.failed : stats.remaining - (stats.failed || 0);
    confirmDialog(retry ? 'Try again?' : `Send “${esc(nl.title)}”?`, retry ? `We’ll try the ${n} address${n === 1 ? '' : 'es'} that failed.` : `The newsletter will be emailed to ${n} ${n === 1 ? 'person' : 'people'} from ${esc((ctx.nlSender || {}).from_email || 'news@mtcatlanta.org')}. This can’t be undone. Keep this page open until it finishes — it takes about a minute for every 100 people.`, async () => { setTimeout(run, 0); }, retry ? 'Try again' : 'Send now');
    async function run() {
      sendBtn.disabled = true; bar.hidden = false; testForm.hidden = true;
      const start = stats.sent;
      let lastSent = -1, sentNow = start;
      try {
        for (;;) {
          const r = await nlInvoke({ action: 'send', newsletter_id: nl.id, retry_failed: retry });
          const total = r.total || stats.total;
          $('i', bar).style.width = `${Math.round((r.sent / Math.max(1, total)) * 100)}%`;
          sentNow = r.sent;
          out.textContent = `Sent ${r.sent} of ${total}…${r.failed ? ` (${r.failed} failed)` : ''}`;
          if (!r.remaining || r.sent === lastSent) break;
          lastSent = r.sent;
        }
        toast(`Newsletter sent to ${sentNow - start} ${sentNow - start === 1 ? 'person' : 'people'}`);
        ctx.nlId = nl.id; await show('newsletters');
      } catch (err) {
        bar.hidden = true; testForm.hidden = false;
        await refreshSendCard();
        out.textContent = `Stopped after ${sentNow - start} sent: ${friendly(err)} Press Send again to carry on where it stopped.`;
      }
    }
    
  };
  refreshSendCard();
}


/* ---------------------------------------------------------------------
   Greetings: birthday & wedding anniversary emails from the register
   (editable templates; send on demand or automatically each morning)
--------------------------------------------------------------------- */
const GR_PLACEHOLDERS = {
  birthday: [['{first_name}', 'first name'], ['{name}', 'full name'], ['{church}', 'church name']],
  anniversary: [['{couple_first}', 'e.g. John & Mary'], ['{couple}', 'e.g. John & Mary Thomas'], ['{years}', 'e.g. 25th'], ['{church}', 'church name']]
};
const GR_RANGES = [['today', 'Today', 0], ['week', 'Next 7 days', 6], ['month', 'Next 30 days', 29]];
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const grDay = (day) => new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

async function grInvoke(body) {
  const { data, error } = await sb.functions.invoke('greetings', { body: { ...body, site_base: NL_SITE_BASE } });
  if (error) {
    let m = error.message;
    try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) { /* keep message */ }
    throw new Error(m);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

VIEWS.greetings = async function () {
  ctx.grRange ||= 'week';
  const today = todayIso();
  const span = GR_RANGES.find((r) => r[0] === ctx.grRange)[2];
  ctx.grFrom = today; ctx.grTo = addDays(today, span);
  const [setRow, list] = await Promise.all([
    sb.from('portal_settings').select('value').eq('key', 'greetings').maybeSingle(),
    grInvoke({ action: 'list', from: ctx.grFrom, to: ctx.grTo }).catch((e) => ({ error: friendly(e), items: [] }))
  ]);
  const G = (setRow.data && setRow.data.value) || {};
  ctx.grSettings = G; ctx.grItems = list.items || [];
  const items = ctx.grItems;
  const sendable = items.filter((i) => i.status !== 'sent' && i.emails.length);
  const row = (i) => `<tr class="${i.status === 'sent' ? 'is-done' : ''}">
    <td class="gr-check">${i.status !== 'sent' && i.emails.length ? `<input type="checkbox" data-gr="${esc(i.id)}" checked aria-label="Send to ${esc(i.name)}">` : ''}</td>
    <td class="nowrap"><strong>${esc(grDay(i.date))}</strong>${i.date === today ? ' <span class="badge">Today</span>' : ''}</td>
    <td><span class="pill pill--${i.kind === 'birthday' ? 'gr-b' : 'gr-a'}">${i.kind === 'birthday' ? 'Birthday' : `Anniversary${i.years ? ` · ${esc(i.years)}` : ''}`}</span></td>
    <td><strong>${esc(i.name)}</strong></td>
    <td class="hide-sm">${i.emails.length ? `<small>${i.emails.map(esc).join('<br>')}</small>${i.via_family ? '<br><small class="muted">to the parents</small>' : ''}` : (i.opted_out ? '<small class="muted">Unsubscribed from greetings</small>' : '<small class="warn">No email in the register</small>')}</td>
    <td>${i.status === 'sent' ? `<small class="ok-text">Sent ${esc(sentDay(i.sent_at))}</small>` : i.status === 'failed' ? `<small class="warn" title="${esc(i.error || '')}">Failed — try again</small>` : '<small class="muted">Not sent</small>'}</td>
  </tr>`;
  const tplCard = (kind) => {
    const t = G[kind] || {}, label = kind === 'birthday' ? 'Birthday email' : 'Anniversary email';
    return `<section class="pcard">
      <div class="pcard__head"><div><h2>${label}</h2><p class="muted small">${kind === 'birthday' ? 'Sent to the person on their birthday. Children without their own email are greeted through their parents’ addresses.' : 'One email to the couple (both addresses), on their wedding anniversary.'}</p></div></div>
      <form class="form form--flat gr-form" data-kind="${kind}">
        <label>Subject<input name="subject" value="${esc(t.subject || '')}" maxlength="140" required></label>
        <div class="gr-img">
          ${t.image_url ? `<img src="${esc(t.image_url)}" alt="">` : '<div class="gr-img__none">No picture</div>'}
          <div>
            <label>Picture (optional)<input type="file" name="image_file" accept="image/jpeg,image/png,image/webp,image/gif"><small class="muted">A card or cake picture shown above the message. Wide images work best.</small></label>
            ${t.image_url ? '<label class="check"><input type="checkbox" name="image_remove"> Remove the picture</label>' : ''}
          </div>
        </div>
        <label>Message<textarea name="message" rows="9" required>${esc(t.message || '')}</textarea></label>
        <label>Signed<textarea name="signoff" rows="3">${esc(t.signoff || '')}</textarea></label>
        <p class="small muted">Fill-ins: ${GR_PLACEHOLDERS[kind].map(([k, d]) => `<button type="button" class="nl-chip" data-ph="${k}" title="${esc(d)}">${k}</button>`).join(' ')} — tap one to add it where the cursor is.</p>
        <div class="nl-actions">
          <button class="btn btn--primary" type="submit">Save</button>
          <button class="btn btn--outline" type="button" data-gr-preview>Preview</button>
          <span class="gr-test"><input type="email" name="test_to" value="${esc(me.email || '')}" aria-label="Send a test to"><button class="btn btn--outline btn--small" type="button" data-gr-test>Send test</button></span>
          <p class="form__msg" role="status"></p>
        </div>
      </form>
    </section>`;
  };
  return `
    <section class="pcard">
      <div class="pcard__head"><div><h2>Birthdays & anniversaries</h2>
        <p class="muted small">From the dates of birth and wedding dates in the parish register (inactive families are skipped). Each person gets each greeting once a year.</p></div></div>
      ${list.error ? `<div class="notice notice--error">${esc(list.error)}</div>` : ''}
      ${list.items && !list.ready && !list.error ? '<div class="notice">Email sending isn’t switched on yet — the church’s Resend key still needs to be added in Supabase. You can set up the templates now.</div>' : ''}
      <div class="seg" role="tablist">${GR_RANGES.map(([k, l]) => `<button data-gr-range="${k}" aria-selected="${k === ctx.grRange}">${l}</button>`).join('')}</div>
      ${items.length ? `<div class="table-wrap"><table class="table gr-table">
        <thead><tr><th></th><th>Date</th><th>Occasion</th><th>Who</th><th class="hide-sm">Goes to</th><th>Status</th></tr></thead>
        <tbody>${items.map(row).join('')}</tbody></table></div>
        <div class="nl-actions"><button class="btn btn--gold" id="gr-send" ${sendable.length && list.ready ? '' : 'disabled'}>Send selected greetings</button>
          <div class="progress" id="gr-progress" hidden><i></i></div><p class="small" id="gr-msg" role="status"></p></div>`
      : `<p class="empty">No birthdays or anniversaries ${ctx.grRange === 'today' ? 'today' : 'in this period'}${list.error ? '' : ' — or the register doesn’t have dates of birth and wedding dates yet'}.</p>`}
      <div class="gr-auto">
        <label class="toggle"><input type="checkbox" id="gr-auto" ${G.auto ? 'checked' : ''}><span><strong>Send automatically every morning</strong> (about 8 AM) to everyone celebrating that day, using the templates below.</span></label>
      </div>
    </section>
    ${tplCard('birthday')}
    ${tplCard('anniversary')}`;
};

BIND.greetings = function () {
  $$('[data-gr-range]', view).forEach((b) => (b.onclick = () => { ctx.grRange = b.dataset.grRange; show('greetings'); }));
  const saveSettings = async (patch) => {
    const value = { ...ctx.grSettings, ...patch };
    ok(await sb.from('portal_settings').upsert({ key: 'greetings', value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
    ctx.grSettings = value;
  };
  $('#gr-auto').onchange = async (e) => {
    const on = e.target.checked;
    try { await saveSettings({ auto: on }); toast(on ? 'Greetings will go out automatically each morning' : 'Automatic greetings turned off'); }
    catch (err) { e.target.checked = !on; toast(friendly(err), true); }
  };
  // Send selected
  const sendBtn = $('#gr-send');
  if (sendBtn) sendBtn.onclick = () => {
    const ids = $$('[data-gr]:checked', view).map((c) => c.dataset.gr);
    if (!ids.length) { toast('Tick at least one greeting', true); return; }
    confirmDialog(`Send ${ids.length} greeting${ids.length === 1 ? '' : 's'}?`, 'Each one is emailed now using the templates below.', async () => { setTimeout(() => run(ids), 0); }, 'Send now');
    async function run(all) {
      const bar = $('#gr-progress'), out = $('#gr-msg');
      sendBtn.disabled = true; bar.hidden = false;
      let sent = 0, failed = 0, left = [...all];
      try {
        while (left.length) {
          const chunk = left.slice(0, 25); left = left.slice(25);
          const r = await grInvoke({ action: 'send', from: ctx.grFrom, to: ctx.grTo, ids: chunk });
          (r.results || []).forEach((x) => (x.status === 'sent' ? sent++ : failed++));
          $('i', bar).style.width = `${Math.round(((all.length - left.length) / all.length) * 100)}%`;
          out.textContent = `Sent ${sent} of ${all.length}…`;
        }
        toast(`${sent} greeting${sent === 1 ? '' : 's'} sent${failed ? `, ${failed} failed` : ''}`, !!failed && !sent);
        await show('greetings');
      } catch (err) { bar.hidden = true; sendBtn.disabled = false; out.textContent = `Stopped: ${friendly(err)}`; }
    }
  };
  // Templates
  $$('.gr-form', view).forEach((form) => {
    const kind = form.dataset.kind;
    let lastField = form.message;
    [form.subject, form.message, form.signoff].forEach((f) => f.addEventListener('focus', () => (lastField = f)));
    $$('[data-ph]', form).forEach((b) => (b.onclick = () => {
      const f = lastField, s = f.selectionStart ?? f.value.length, e = f.selectionEnd ?? s;
      f.value = f.value.slice(0, s) + b.dataset.ph + f.value.slice(e); f.focus(); f.selectionStart = f.selectionEnd = s + b.dataset.ph.length;
    }));
    const current = () => ({ ...(ctx.grSettings[kind] || {}), subject: form.subject.value.trim(), message: form.message.value.trim(), signoff: form.signoff.value.trim() });
    async function withImage(t) {
      const file = form.image_file.files[0];
      if (form.image_remove && form.image_remove.checked) t.image_url = null;
      if (file) {
        if (!/^image\//.test(file.type)) throw new Error('The picture must be an image (JPG or PNG).');
        const img = await prepareImage(file, 1400, 0.85);
        const path = `greetings/${kind}-${Date.now()}-${img.name.replace(/[^\w.\-]+/g, '-').toLowerCase()}`;
        ok(await sb.storage.from('flyers').upload(path, img, { contentType: img.type || 'image/jpeg', cacheControl: '31536000' }));
        t.image_url = sb.storage.from('flyers').getPublicUrl(path).data.publicUrl;
      }
      return t;
    }
    form.onsubmit = async (e) => {
      e.preventDefault(); busy(form, true);
      try { await saveSettings({ [kind]: await withImage(current()) }); toast('Template saved'); await show('greetings'); }
      catch (err) { msg(form, friendly(err), true); } finally { busy(form, false); }
    };
    $('[data-gr-preview]', form).onclick = async () => {
      busy(form, true); msg(form, 'Making the preview…');
      try {
        const t = current();
        const f = form.image_file.files[0];
        if (form.image_remove && form.image_remove.checked) t.image_url = null;
        const r = await grInvoke({ action: 'render', kind, template: t });
        msg(form, '');
        const d = dialog(`Preview: ${esc(r.subject)}`, '<iframe class="gr-preview" title="Email preview"></iframe><p class="muted small">Shown with sample names. Unsaved changes are included.</p>', null, { wide: true });
        $('button[value=cancel]', d).textContent = 'Close';
        const fr = $('iframe', d); fr.srcdoc = r.html;
        if (f) fr.onload = () => { const im = fr.contentDocument.querySelector('img[width="504"]'); const u = URL.createObjectURL(f); if (im) im.src = u; else { const td = fr.contentDocument.querySelectorAll('table table tr')[0]; if (td) td.insertAdjacentHTML('afterend', `<tr><td style="padding:20px 28px 0"><img src="${u}" style="display:block;width:100%;border-radius:10px"></td></tr>`); } };
      } catch (err) { msg(form, friendly(err), true); } finally { busy(form, false); }
    };
    $('[data-gr-test]', form).onclick = async () => {
      const to = form.test_to.value.trim();
      if (!to) { msg(form, 'Enter an email address for the test.', true); return; }
      busy(form, true); msg(form, 'Sending a test…');
      try {
        const t = current();
        if (form.image_file.files[0]) { msg(form, 'Save first to include the new picture in the test.', true); return; }
        const r = await grInvoke({ action: 'test', kind, to, template: t }); msg(form, r.message);
      } catch (err) { msg(form, friendly(err), true); } finally { busy(form, false); }
    };
  });
};


/* ---------------------------------------------------------------------
   ICON (IconCMO) connection — Portal Settings, admins only.
   Pull → staging → merge; "Preview" rolls the merge back and reports.
--------------------------------------------------------------------- */
async function iconCall(body) {
  const { data, error } = await sb.functions.invoke('icon-sync', { body });
  if (error) {
    let m = error.message;
    try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) { /* keep */ }
    throw new Error(m);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
const n0 = (v) => Number(v || 0).toLocaleString('en-US');
function iconSummaryHtml(s) {
  if (!s) return '';
  const h = s.households || {}, m = s.members || {}, c = s.contributions || {};
  return `<div class="icon-sum">
    <div class="icon-sum__head">${s.dry_run ? '<span class="pill">Preview — nothing was changed</span>' : '<span class="pill pill--both">Synced</span>'} ${s.source === 'test' ? '<span class="pill">ICON test database</span>' : ''}</div>
    <div class="stat-row">
      <div class="stat"><strong>${n0(h.new)}</strong><span>new families</span><small>${n0(h.updated)} updated</small></div>
      <div class="stat"><strong>${n0(m.new)}</strong><span>new members</span><small>${n0(m.updated)} updated${m.marked_inactive ? ` · ${n0(m.marked_inactive)} now inactive` : ''}</small></div>
      <div class="stat"><strong>${n0(c.new)}</strong><span>new gifts</span><small>${n0(c.changed)} changed · ${n0(c.removed)} removed</small></div>
    </div>
    <ul class="small icon-sum__notes">
      <li>Gifts ${c.from ? `${esc(date(c.from))} – ${esc(date(c.to))}` : ''}: ${money(c.total_amount || 0)} in total; ${n0(s.pledges)} pledges.</li>
      ${c.no_household ? `<li class="warn">${n0(c.no_household)} gifts belong to households that aren’t in ICON’s household list (for example deleted households) and were left out.</li>` : ''}
      ${m.emails_not_changed ? `<li>${n0(m.emails_not_changed)} members kept their portal email: either they already sign in with a different one, or another member already uses that address (e.g. a shared family email).</li>` : ''}
      ${(h.examples_new || []).length ? `<li class="muted">New families include: ${(h.examples_new || []).map(esc).join(', ')}…</li>` : ''}
    </ul>
  </div>`;
}

function iconCardHtml() {
  return `<section class="pcard" id="icon-card">
    <div class="pcard__head"><div><h2>ICON (IconCMO)</h2>
      <p class="muted small">Copies families, members (with birthdays and anniversaries) and giving from ICON into the portal. It only reads from ICON — nothing in ICON is ever changed. Each family still sees only its own giving.</p></div></div>
    <div id="icon-status" class="muted small">Checking…</div>
    <div class="icon-controls">
      <label>Data from<select id="icon-source"><option value="test">ICON test database (sample data)</option><option value="live">Our church’s ICON</option></select></label>
      <label>Gift history from<input type="number" id="icon-start" min="2000" max="2100" step="1"></label>
    </div>
    <div class="btn-row">
      <button class="btn btn--outline btn--small" id="icon-test">Check connection</button>
      <button class="btn btn--outline btn--small" id="icon-preview">Preview sync</button>
      <button class="btn btn--primary btn--small" id="icon-sync">Sync now</button>
    </div>
    <div class="progress" id="icon-progress" hidden><i></i></div>
    <p class="small" id="icon-msg" role="status"></p>
    <div id="icon-result"></div>
    <div class="toggles icon-toggles">
      <label class="toggle"><input type="checkbox" id="icon-nightly"><span>Sync every night (about 3 AM)</span></label>
      <label class="toggle"><input type="checkbox" id="icon-giving"><span>Giving comes from ICON — hide manual entry in Admin → Giving</span></label>
    </div>
    <details class="icon-help"><summary>How to connect the church’s ICON account</summary>
      <ol class="small">
        <li>In ICON, go to <strong>Web-Services → Setup → Web Service Security</strong> and create a user just for the website (for example <em>website-sync</em>).</li>
        <li>Give it <strong>Read</strong> permission only, for Membership (households, members) and Contributions (posted, pledges). No create, update or delete.</li>
        <li>Add three secrets in Supabase → Edge Functions → Secrets: <code>ICON_PHONE</code> (the church’s ICON phone number), <code>ICON_USERNAME</code>, <code>ICON_PASSWORD</code>.</li>
        <li>Choose “Our church’s ICON”, press <strong>Check connection</strong>, then <strong>Preview sync</strong> and look over the numbers before <strong>Sync now</strong>.</li>
      </ol></details>
    <div id="icon-runs"></div>
  </section>`;
}

function bindIcon() {
  const status = $('#icon-status'), src = $('#icon-source'), start = $('#icon-start'), out = $('#icon-msg'), bar = $('#icon-progress'), res = $('#icon-result');
  const btns = ['#icon-test', '#icon-preview', '#icon-sync'].map((x) => $(x));
  let st = null;
  const nowY = new Date().getFullYear();
  async function refresh() {
    try {
      st = await iconCall({ action: 'status' });
      const S = st.settings || {};
      status.innerHTML = st.live_configured ? '<span class="ok-text">Church ICON login added ✓</span>' : 'The church’s ICON login hasn’t been added yet — you can try everything with ICON’s test database meanwhile.';
      src.querySelector('option[value=live]').disabled = !st.live_configured;
      if (!st.live_configured) src.value = 'test';
      start.value = S.start_year || nowY - 3;
      $('#icon-nightly').checked = !!S.enabled; $('#icon-nightly').disabled = !st.live_configured;
      $('#icon-giving').checked = !!S.giving_from_icon;
      syncBtnState();
      const runs = st.runs || [];
      $('#icon-runs').innerHTML = runs.length ? `<h3 class="nl-h">Recent runs</h3><div class="table-wrap"><table class="table table--compact"><tbody>${runs.map((r) => `<tr>
        <td class="nowrap">${esc(new Date(r.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td>
        <td>${r.dry_run ? 'Preview' : 'Sync'} · ${r.source === 'test' ? 'test data' : 'church ICON'} · ${esc(r.trigger)}</td>
        <td>${r.ok === false ? `<span class="warn">Failed: ${esc((r.error || '').slice(0, 120))}</span>` : r.ok ? `${n0(r.summary?.members?.new)} new members · ${n0(r.summary?.contributions?.new)} new gifts` : '<span class="muted">Running…</span>'}</td></tr>`).join('')}</tbody></table></div>` : '';
    } catch (e) { status.innerHTML = `<span class="warn">${esc(friendly(e))}</span>`; }
  }
  const syncBtnState = () => { $('#icon-sync').disabled = src.value !== 'live'; $('#icon-sync').title = src.value !== 'live' ? 'Test data is only ever previewed' : ''; };
  src.onchange = syncBtnState;
  const saveIcon = async (patch) => {
    const cur = (st && st.settings) || {};
    const value = { ...cur, ...patch };
    ok(await sb.from('portal_settings').upsert({ key: 'icon', value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
    if (st) st.settings = value;
  };
  $('#icon-nightly').onchange = async (e) => { try { await saveIcon({ enabled: e.target.checked }); toast(e.target.checked ? 'ICON will sync every night' : 'Nightly ICON sync turned off'); } catch (err) { e.target.checked = !e.target.checked; toast(friendly(err), true); } };
  $('#icon-giving').onchange = async (e) => { try { await saveIcon({ giving_from_icon: e.target.checked }); toast(e.target.checked ? 'Admin → Giving now shows ICON as the source' : 'Manual giving entry is back'); } catch (err) { e.target.checked = !e.target.checked; toast(friendly(err), true); } };
  start.onchange = () => saveIcon({ start_year: Math.max(2000, Math.min(nowY, Number(start.value) || nowY - 3)) }).catch(() => {});

  const busyAll = (on) => btns.forEach((b) => (b.disabled = on || (b.id === 'icon-sync' && src.value !== 'live')));
  $('#icon-test').onclick = async () => {
    busyAll(true); out.textContent = 'Signing in to ICON…'; res.innerHTML = '';
    try {
      const r = await iconCall({ action: 'test', source: src.value });
      out.innerHTML = `<span class="ok-text">Connected.</span> ${n0(r.households)} households; ${typeof r.gifts_this_year === 'number' ? `${n0(r.gifts_this_year)} gifts so far this year` : esc(String(r.gifts_this_year))}. ICON role: ${esc(r.role || '?')}.`
        + (r.permissions && (r.permissions.update || r.permissions.delete) && src.value === 'live' ? ' <span class="warn">This ICON user can also change data — for safety, give it read-only permission in ICON.</span>' : '');
    } catch (e) { out.innerHTML = `<span class="warn">${esc(friendly(e))}</span>`; }
    busyAll(false);
  };
  async function run(dry) {
    const source = src.value;
    const from = source === 'test' ? nowY : Math.max(2000, Number(start.value) || nowY - 3);   // test data: this year only
    busyAll(true); bar.hidden = false; res.innerHTML = '';
    const step = (t, pct) => { out.textContent = t; $('i', bar).style.width = `${pct}%`; };
    try {
      step('Getting ready…', 3);
      await iconCall({ action: 'pull', source, part: 'start' });
      step('Reading families and members from ICON…', 10);
      const mem = await iconCall({ action: 'pull', source, part: 'membership' });
      const years = []; for (let y = from; y <= nowY; y++) years.push(y);
      let staged = 0;
      for (let i = 0; i < years.length; i++) {
        let next = 0;
        do {
          step(`Reading ${years[i]} gifts… (${n0(staged)} so far)`, 15 + Math.round((i / years.length) * 70));
          const r = await iconCall({ action: 'pull', source, part: 'contributions', year: years[i], startAt: next });
          staged += r.staged; next = r.next;
        } while (next > 0);
      }
      step(dry ? `Working out what would change (${n0(mem.households)} households, ${n0(staged)} gifts)…` : 'Updating the portal…', 90);
      const r = await iconCall({ action: 'merge', source, from: `${from}-01-01`, to: `${nowY}-12-31`, dry });
      step(dry ? 'Preview ready — nothing has been changed.' : 'Done.', 100);
      res.innerHTML = iconSummaryHtml(r.summary);
      if (!dry) toast('ICON sync finished');
    } catch (e) { out.innerHTML = `<span class="warn">Stopped: ${esc(friendly(e))}</span>`; }
    bar.hidden = true; busyAll(false); refresh();
  }
  $('#icon-preview').onclick = () => run(true);
  $('#icon-sync').onclick = () => confirmDialog('Sync from ICON now?', 'Families, members, gifts and pledges in the portal will be updated to match ICON. Run “Preview sync” first if you haven’t yet.', async () => { setTimeout(() => run(false), 0); }, 'Sync now');
  refresh();
}

{
  const viewSettings = VIEWS.settings, bindSettings = BIND.settings;
  VIEWS.settings = async function () { const html = await viewSettings.call(VIEWS); return isAdmin() ? html + iconCardHtml() : html; };
  BIND.settings = function () { if (bindSettings) bindSettings.call(BIND); if (isAdmin() && $('#icon-card')) bindIcon(); };
}


/* ---------------------------------------------------------------------
   Online giving (Zeffy) — Portal Settings, admins only.
   Zeffy hosts the forms and takes the payments; the site embeds them and
   Zeffy's webhook reports each completed payment back (zeffy-webhook).
--------------------------------------------------------------------- */
const ZF_FIELDS = [
  ['donate_url', 'Donation form link', 'Used by the Donate button in the main menu and the Give page.'],
  ['monthly_url', 'Monthly subscription form link', 'A Zeffy donation form set to monthly giving. Members see it under Giving.'],
  ['other_url', 'Other payments form link (optional)', 'For events, special offerings or a shop — any Zeffy form.']
];
function zeffyCardHtml() {
  return `<section class="pcard" id="zeffy-card">
    <div class="pcard__head"><div><h2>Online giving (Zeffy)</h2>
      <p class="muted small">Donations and monthly subscriptions are paid on the church’s Zeffy forms, shown inside the website. Every payment — including each monthly charge — is reported back here and matched to a family by email.</p></div></div>
    <form id="zf-form" class="zf-links">
      ${ZF_FIELDS.map(([k, l, h]) => `<label>${l}<input type="url" name="${k}" placeholder="https://www.zeffy.com/en-US/donation-form/…"><small>${h}</small></label>`).join('')}
      <label>Category for monthly payments<input name="monthly_category" maxlength="60"><small>How monthly payments are labelled on giving statements (when giving isn’t coming from ICON).</small></label>
      <label>Note shown with the monthly option<textarea name="monthly_note" rows="2" maxlength="300"></textarea></label>
      <label>Note shown with other payments<textarea name="other_note" rows="2" maxlength="300"></textarea></label>
      <div class="btn-row"><button class="btn btn--primary btn--small" type="submit">Save links</button> <a class="btn btn--outline btn--small" href="../give/" target="_blank" rel="noopener">View the Give page</a></div>
      <p class="small" id="zf-msg" role="status"></p>
    </form>
    <h3 class="nl-h">Webhook address</h3>
    <p class="muted small">Paste this into Zeffy → <strong>Settings → Integrations → Webhooks</strong> so payments appear here. Keep it private — it contains the church’s secret key.</p>
    <div class="zf-hook"><code id="zf-hook">Loading…</code><button class="btn btn--outline btn--small" type="button" id="zf-copy">Copy</button></div>
    <details class="icon-help"><summary>How to set up Zeffy</summary>
      <ol class="small">
        <li>Create the church’s free account at <a href="https://www.zeffy.com" target="_blank" rel="noopener">zeffy.com</a> and finish the bank (payout) verification.</li>
        <li>Create a <strong>donation form</strong> for general giving. Copy its link (Share → copy link) into “Donation form link”.</li>
        <li>Create a second donation form called <em>Monthly Subscription</em> with <strong>monthly</strong> as the only frequency (you can set suggested amounts). Paste its link into “Monthly subscription form link”. Zeffy charges members each month and emails them a link to change or cancel.</li>
        <li>Optional: create a ticketing or donation form for other payments and paste its link.</li>
        <li>In Zeffy → Settings → Integrations, add a webhook with the address above. Make a small test payment and check it appears below.</li>
        <li>Optional extra check: generate a Zeffy API key and add it as the Supabase secret <code>ZEFFY_API_KEY</code>; each payment is then confirmed with Zeffy before it’s recorded.</li>
      </ol>
      <p class="small muted">While giving comes from ICON, online payments are listed here and in each member’s Giving page, and appear on statements once the treasurer posts them in ICON. Otherwise they’re added to the family’s giving automatically.</p>
    </details>
    <h3 class="nl-h">Recent online payments</h3>
    <div id="zf-payments" class="muted small">Loading…</div>
  </section>`;
}

function bindZeffy() {
  const form = $('#zf-form'), out = $('#zf-msg');
  let cur = {};
  (async () => {
    try {
      const row = ok(await sb.from('portal_settings').select('value').eq('key', 'zeffy').maybeSingle());
      cur = (row && row.value) || {};
      ['donate_url', 'monthly_url', 'other_url', 'monthly_category', 'monthly_note', 'other_note'].forEach((k) => (form[k].value = cur[k] || ''));
    } catch (e) { out.innerHTML = `<span class="warn">${esc(friendly(e))}</span>`; }
    try { $('#zf-hook').textContent = ok(await sb.rpc('zeffy_webhook_url')); } catch (e) { $('#zf-hook').textContent = friendly(e); }
  })();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    for (const [k, l] of ZF_FIELDS) {
      v[k] = (v[k] || '').trim();
      if (v[k] && !/^https:\/\/([\w-]+\.)*zeffy\.com\//i.test(v[k])) { out.innerHTML = `<span class="warn">${l} should be a zeffy.com link.</span>`; return; }
    }
    busy(form, true);
    try {
      const value = { ...cur, ...v };
      ok(await sb.from('portal_settings').upsert({ key: 'zeffy', value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
      cur = value; out.textContent = ''; toast('Online giving links saved');
    } catch (err) { out.innerHTML = `<span class="warn">${esc(friendly(err))}</span>`; } finally { busy(form, false); }
  };
  $('#zf-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#zf-hook').textContent); toast('Webhook address copied'); } catch (e) { toast('Select the address and copy it', true); }
  };
  loadZeffyPayments();
}

async function loadZeffyPayments() {
  const box = $('#zf-payments');
  try {
    const [rs, fs] = await Promise.all([
      sb.from('zeffy_payments').select('id, paid_at, received_at, amount, name, email, campaign, kind, status, family_id, contribution_id, family:families(family_name)').order('paid_at', { ascending: false }).limit(30),
      sb.from('families').select('id, family_name').order('family_name')
    ]);
    const rows = ok(rs), fams = ok(fs);
    if (!rows.length) { box.innerHTML = 'No online payments yet. They appear here as soon as Zeffy reports them.'; return; }
    const famOpts = fams.map((f) => `<option value="${esc(f.id)}">${esc(f.family_name)}</option>`).join('');
    box.classList.remove('muted', 'small');
    box.innerHTML = `<div class="table-wrap"><table class="table table--compact"><thead><tr><th>Date</th><th>From</th><th>For</th><th>Family</th><th class="num">Amount</th></tr></thead><tbody>${rows.map((r) => `<tr>
      <td class="nowrap">${date((r.paid_at || r.received_at).slice(0, 10))}</td>
      <td>${esc(r.name || '')}<br><small class="muted">${esc(r.email || '')}</small></td>
      <td>${esc(r.campaign || r.kind)}${r.kind === 'monthly' ? ' <span class="pill">Monthly</span>' : ''}${r.status !== 'succeeded' ? ` <span class="warn small">${esc(r.status)}</span>` : ''}</td>
      <td>${r.family_id ? `${esc(r.family?.family_name || '')}${r.contribution_id ? ' <span class="pill pill--both">Posted</span>' : ''}` : `<select class="zf-match" data-zf-match="${esc(r.id)}" aria-label="Match to a family"><option value="">Not matched — choose family…</option>${famOpts}</select>`}</td>
      <td class="num">${money(r.amount)}</td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-zf-match]', box).forEach((s) => (s.onchange = async () => {
      if (!s.value) return;
      try { ok(await sb.from('zeffy_payments').update({ family_id: s.value }).eq('id', s.dataset.zfMatch)); toast('Payment matched to the family'); loadZeffyPayments(); }
      catch (e) { toast(friendly(e), true); s.value = ''; }
    }));
  } catch (e) { box.innerHTML = `<span class="warn">${esc(friendly(e))}</span>`; }
}

{
  const viewSettings = VIEWS.settings, bindSettings = BIND.settings;
  VIEWS.settings = async function () { const html = await viewSettings.call(VIEWS); return isAdmin() ? html + zeffyCardHtml() : html; };
  BIND.settings = function () { if (bindSettings) bindSettings.call(BIND); if (isAdmin() && $('#zeffy-card')) bindZeffy(); };
}

/* ---------------------------------------------------------------------
   New Members: requests from the website form
--------------------------------------------------------------------- */
const NM_STATUS = { new: 'New', contacted: 'Contacted', added: 'Added to register', declined: 'Closed' };
const nmName = (r) => `${r.first_name} ${r.last_name}`;
const nmWhen = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const TRANSFER = { yes: 'Has a transfer letter', requested: 'Has asked for one', no: 'Not yet', unsure: 'Not sure / not needed' };

async function refreshNmCount() {
  try {
    const { count } = await sb.from('new_member_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
    const el = $('#nm-count'); if (el) { el.textContent = count || ''; el.hidden = !count; }
  } catch (e) { /* ignore */ }
}

VIEWS.newmembers = async function () {
  const rows = ok(await sb.from('new_member_requests').select('*').order('created_at', { ascending: false }).limit(500));
  ctx.nmRows = rows;
  refreshNmCount();
  if (ctx.nmId) {
    const r = rows.find((x) => x.id === ctx.nmId);
    if (r) return nmDetail(r);
    ctx.nmId = null;
  }
  const filter = ctx.nmFilter || 'new';
  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  const { data: cfgRow } = await sb.from('portal_settings').select('value').eq('key', 'new_members').maybeSingle();
  const cfg = { enabled: true, recipients: ['vicar@mtcatlanta.org', 'secretary@mtcatlanta.org'], ...((cfgRow && cfgRow.value) || {}) };
  const emailOff = rows.length && rows.every((r) => r.email_status === 'not configured');
  const failed = rows.find((r) => r.email_status && r.email_status.startsWith('failed'));
  return `
    <section class="pcard">
      <div class="pcard__head"><div><h2>New member requests</h2>
        <p class="muted small">From the <a href="../new-members/" target="_blank" rel="noopener">New Members form</a> on the website. Each request is emailed to ${esc(cfg.recipients.join(' and '))}.</p></div></div>
      ${emailOff ? '<div class="notice">Email notifications aren’t switched on yet, so requests are only saved here. See “Email notifications” below.</div>' : ''}
      ${!emailOff && failed ? `<div class="notice notice--error">The last email notification failed: ${esc(failed.email_status.slice(8))}</div>` : ''}
      <div class="seg" role="tablist">${[['new', 'New'], ['contacted', 'Contacted'], ['added', 'Added'], ['declined', 'Closed'], ['all', 'All']].map(([k, l]) => `<button data-nmf="${k}" aria-selected="${k === filter}">${l} <span class="muted">${k === 'all' ? rows.length : rows.filter((r) => r.status === k).length}</span></button>`).join('')}</div>
      ${shown.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Received</th><th>Name</th><th class="hide-sm">Family</th><th>Status</th><th></th></tr></thead>
        <tbody>${shown.map((r) => `<tr>
          <td class="nowrap">${esc(nmWhen(r.created_at))}</td>
          <td><strong>${esc(nmName(r))}</strong><br><small class="muted">${esc(r.email)} · ${esc(r.phone || '')}</small></td>
          <td class="hide-sm">${(r.family || []).length ? esc((r.family || []).map((f) => f.first_name).join(', ')) : '<span class="muted">—</span>'}</td>
          <td><span class="pill pill--nm-${r.status}">${NM_STATUS[r.status]}</span></td>
          <td class="row-actions"><button class="link-btn" data-nmopen="${r.id}">Open</button></td></tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">${filter === 'new' ? 'No new requests. When someone fills in the New Members form it appears here.' : 'Nothing here.'}</p>`}
    </section>
    <section class="pcard">
      <h2>Email notifications</h2>
      <form id="nm-settings" class="form form--flat">
        <label>Send each request to <small class="muted">— one email address per line</small><textarea name="recipients" rows="3" ${isAdmin() ? '' : 'disabled'}>${esc(cfg.recipients.join('\n'))}</textarea></label>
        <label class="toggle"><input type="checkbox" name="enabled" ${cfg.enabled !== false ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}><span>Accept new member forms on the website</span></label>
        ${isAdmin() ? '<div><button class="btn btn--primary" type="submit">Save</button><p class="form__msg" role="status"></p></div>' : '<p class="muted small">Only an admin can change these.</p>'}
        <p class="muted small">Emails are sent through the same service as newsletters and greetings, so they start working once that is set up (a Resend account with mtcatlanta.org verified, and its key saved in Supabase as RESEND_API_KEY). Requests are always saved here either way.</p>
      </form>
    </section>`;
};

function nmDetail(r) {
  const fam = r.family || [];
  const addr = [r.address_line1, r.address_line2, [r.city, r.state].filter(Boolean).join(', ') + (r.zip ? ' ' + r.zip : '')].filter((x) => x && x.trim()).join('\n');
  const kv = (k, v) => `<div class="kv"><dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">—</span>'}</dd></div>`;
  return `
    <button class="link-btn back" id="nm-back">← All requests</button>
    <div class="grid-2 grid-2--wide-left nm-detail">
      <section class="pcard">
        <div class="pcard__head"><h2>${esc(nmName(r))}</h2><span class="pill pill--nm-${r.status}">${NM_STATUS[r.status]}</span></div>
        <p class="muted small">Received ${esc(nmWhen(r.created_at))}${r.email_status ? ` · Email to staff: ${esc(r.email_status)}` : ''}</p>
        <dl class="kvs">
          <div class="kv"><dt>Email</dt><dd><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></dd></div>
          <div class="kv"><dt>Phone</dt><dd>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</dd></div>
          ${kv('Address', addr)}
          ${kv('Home parish (India)', r.home_parish)}
          ${kv('Most recent parish', r.previous_parish)}
          ${kv('Transfer letter', TRANSFER[r.transfer_letter] || '')}
          ${kv('Moved to Atlanta', r.moved_on ? date(r.moved_on) : '')}
          ${kv('Wedding date', r.wedding_date ? date(r.wedding_date) : '')}
          ${kv('Interested in', (r.organizations || []).join(', '))}
          ${kv('Heard about us', r.heard_from)}
          ${kv('Message', r.message)}
        </dl>
      </section>
      <div>
        <section class="pcard">
          <h2>Family</h2>
          <ul class="nm-fam">
            <li><strong>${esc(nmName(r))}</strong> <span class="muted">— Head</span></li>
            ${fam.map((f) => `<li>${esc(f.first_name)} ${esc(f.last_name || r.last_name)} <span class="muted">— ${esc(f.relationship)}${f.date_of_birth ? `, born ${esc(date(f.date_of_birth))}` : ''}</span></li>`).join('')}
          </ul>
        </section>
        <section class="pcard">
          <h2>Follow-up</h2>
          <form id="nm-notes" class="form form--flat">
            <label>Notes for the office <small class="muted">— only officers see these</small><textarea name="staff_notes" rows="4">${esc(r.staff_notes || '')}</textarea></label>
            <div class="btn-row">
              <button class="btn btn--outline btn--small" type="submit">Save notes</button>
              ${r.status !== 'contacted' && r.status !== 'added' ? '<button class="btn btn--outline btn--small" type="button" data-nmstatus="contacted">Mark as contacted</button>' : ''}
              ${r.status !== 'added' ? '<button class="btn btn--primary btn--small" type="button" id="nm-add">Add family to the parish register</button>' : `<button class="btn btn--primary btn--small" type="button" id="nm-open-family">Open family record</button>`}
              ${r.status !== 'declined' && r.status !== 'added' ? '<button class="link-btn link-btn--danger" type="button" data-nmstatus="declined">Close request</button>' : ''}
              ${r.status === 'declined' ? '<button class="link-btn" type="button" data-nmstatus="new">Reopen</button>' : ''}
            </div>
            <p class="form__msg" role="status"></p>
          </form>
        </section>
      </div>
    </div>`;
}

BIND.newmembers = function () {
  $$('[data-nmf]', view).forEach((b) => (b.onclick = () => { ctx.nmFilter = b.dataset.nmf; show('newmembers'); }));
  $$('[data-nmopen]', view).forEach((b) => (b.onclick = () => { ctx.nmId = b.dataset.nmopen; show('newmembers'); }));
  const back = $('#nm-back'); if (back) back.onclick = () => { ctx.nmId = null; show('newmembers'); };
  const r = ctx.nmId && ctx.nmRows.find((x) => x.id === ctx.nmId);
  const stamp = () => ({ handled_by: me.id, handled_at: new Date().toISOString() });
  const notes = $('#nm-notes');
  if (notes && r) {
    notes.onsubmit = async (e) => { e.preventDefault(); ok(await sb.from('new_member_requests').update({ staff_notes: notes.staff_notes.value.trim() || null }).eq('id', r.id)); toast('Notes saved'); };
    $$('[data-nmstatus]', notes).forEach((b) => (b.onclick = async () => {
      ok(await sb.from('new_member_requests').update({ status: b.dataset.nmstatus, staff_notes: notes.staff_notes.value.trim() || null, ...stamp() }).eq('id', r.id));
      toast(b.dataset.nmstatus === 'declined' ? 'Request closed' : b.dataset.nmstatus === 'new' ? 'Reopened' : 'Marked as contacted'); await show('newmembers');
    }));
    const add = $('#nm-add');
    if (add) add.onclick = () => {
      const fam = r.family || [];
      const spouse = fam.find((f) => f.relationship === 'Spouse');
      const familyName = `${r.last_name}, ${r.first_name}${spouse ? ' & ' + spouse.first_name : ''}`;
      confirmDialog('Add this family to the parish register?', `This creates the family <strong>${esc(familyName)}</strong> with ${fam.length + 1} ${fam.length ? 'people' : 'person'}. You can edit everything afterwards, and invite them to the member portal from their family page.`, async () => {
        const f = ok(await sb.from('families').insert({
          family_name: familyName, address_line1: r.address_line1, address_line2: r.address_line2, city: r.city, state: r.state, zip: r.zip,
          home_phone: null, home_parish: r.home_parish, member_since: todayIso(), status: 'active'
        }).select('id').single());
        const people = [{ family_id: f.id, first_name: r.first_name, last_name: r.last_name, relationship: 'Head', email: r.email, mobile_phone: r.phone, wedding_date: r.wedding_date }]
          .concat(fam.map((p) => ({ family_id: f.id, first_name: p.first_name, last_name: p.last_name || r.last_name, relationship: p.relationship || 'Other', date_of_birth: p.date_of_birth || null, wedding_date: p.relationship === 'Spouse' ? r.wedding_date : null })));
        ok(await sb.from('members').insert(people));
        ok(await sb.from('new_member_requests').update({ status: 'added', family_id: f.id, staff_notes: notes.staff_notes.value.trim() || null, ...stamp() }).eq('id', r.id));
        toast('Family added to the register');
        ctx.nmId = null; ctx.familyId = f.id; ctx.membersMode = 'families'; show('members');
      });
    };
    const open = $('#nm-open-family');
    if (open) open.onclick = () => { if (!r.family_id) return toast('The family record was removed.'); ctx.nmId = null; ctx.familyId = r.family_id; ctx.membersMode = 'families'; show('members'); };
  }
  const sf = $('#nm-settings');
  if (sf && isAdmin()) sf.onsubmit = async (e) => {
    e.preventDefault();
    const recipients = [...new Set(sf.recipients.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x)))].slice(0, 10);
    if (!recipients.length) return msg(sf, 'Enter at least one email address.', true);
    busy(sf, true);
    try { ok(await sb.from('portal_settings').upsert({ key: 'new_members', value: { recipients, enabled: sf.enabled.checked }, updated_at: new Date().toISOString() }, { onConflict: 'key' })); toast('Saved'); await show('newmembers'); }
    catch (err) { msg(sf, friendly(err), true); } finally { busy(sf, false); }
  };
};
