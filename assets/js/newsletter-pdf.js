// Builds the parish newsletter PDF in the browser (Admin → Newsletters).
// Text is real PDF text (sharp, searchable, clickable links). Paragraphs written in Malayalam are
// drawn by the browser first and placed as images, because PDF fonts can't shape Malayalam script.

const PDFMAKE = 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/';
const C = { primary: '#4f6d8f', deep: '#3d5875', gold: '#c09243', goldSoft: '#e8d3a6', ink: '#1f2a36', muted: '#5f6b78', line: '#e2e8ef', tint: '#f4f7fa', link: '#2f5d8a' };
const PAGE_W = 612, MARGIN = 48, CONTENT_W = PAGE_W - MARGIN * 2;
const MALAYALAM = /[ഀ-ൿ]/;
const TZ = 'America/New_York';

let loader = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the PDF tools. Check your internet connection and try again.'));
    document.head.appendChild(s);
  });
}
export function loadPdfMake() {
  if (window.pdfMake && window.pdfMake.vfs) return Promise.resolve(window.pdfMake);
  loader ||= loadScript(PDFMAKE + 'pdfmake.min.js').then(() => loadScript(PDFMAKE + 'vfs_fonts.js')).then(() => window.pdfMake);
  return loader;
}

/* ---------- helpers ---------- */
const parts = (iso) => {
  const d = new Date(iso);
  const f = (o) => d.toLocaleString('en-US', { timeZone: TZ, ...o });
  return { mon: f({ month: 'short' }).toUpperCase(), day: f({ day: 'numeric' }), wk: f({ weekday: 'short' }) };
};
export function eventWhen(ev) {
  const s = new Date(ev.starts_at);
  const day = s.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  if (ev.all_day) {
    if (ev.ends_at && new Date(ev.ends_at).toDateString() !== s.toDateString()) {
      return `${day} – ${new Date(ev.ends_at).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' })}`;
    }
    return day;
  }
  const t = (d) => d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return `${day} · ${t(s)}${ev.ends_at ? ` – ${t(new Date(ev.ends_at))}` : ''}`;
}
const paras = (text) => String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

/** Draw text (any script) onto a canvas, wrapped to `width` points; returns a pdfmake image node. */
function textImage(text, width, { size = 10.5, bold = false, color = C.ink, lineHeight = 1.45, margin = [0, 0, 0, 6] } = {}) {
  const scale = 3;
  const font = `${bold ? '700 ' : ''}${size * scale}px "Noto Sans Malayalam", "Nirmala UI", "Kartika", "Manjari", system-ui, sans-serif`;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const maxW = width * scale, lines = [];
  for (const raw of String(text).split('\n')) {
    let line = '';
    for (const word of raw.split(/(\s+)/)) {
      const test = line + word;
      if (g.measureText(test).width > maxW && line.trim()) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line = test;
    }
    lines.push(line);
  }
  const lh = size * lineHeight * scale;
  c.width = Math.ceil(maxW); c.height = Math.ceil(lh * lines.length + size * 0.4 * scale);
  g.font = font; g.fillStyle = color; g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, 0, i * lh + size * 0.15 * scale));
  return { image: c.toDataURL('image/png'), width, margin };
}
/** A paragraph as PDF text, or as an image when it contains Malayalam. */
function para(text, width, style = {}) {
  if (MALAYALAM.test(text)) return textImage(text, width, style);
  return { text, fontSize: style.size || 10.5, bold: !!style.bold, color: style.color || C.ink, lineHeight: style.lineHeight || 1.3, margin: style.margin || [0, 0, 0, 6] };
}
const paraBlock = (text, width, style) => paras(text).map((p) => para(p, width, style));

/** Fetch an image (any web format) and return a JPEG/PNG data URL pdfmake can embed. */
async function imageData(url, maxSide = 700) {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch (e) { return null; }
}

function heading(text) {
  return { stack: [
    MALAYALAM.test(text) ? textImage(text, CONTENT_W, { size: 15, bold: true, color: C.deep, margin: [0, 0, 0, 2] }) : { text, fontSize: 15, bold: true, color: C.deep },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 36, h: 2.5, color: C.gold }], margin: [0, 3, 0, 10] }
  ], margin: [0, 18, 0, 0] };
}
const linkLine = (url, label = 'More details') => url ? { text: [{ text: `${label}: `, color: C.muted }, { text: url.replace(/^https?:\/\//, '').replace(/\/$/, ''), link: url, color: C.link, decoration: 'underline' }], fontSize: 9, margin: [0, 0, 0, 4] } : null;

/**
 * nl: { title, content }   church: { name, address, phone, email, website, livestream, vicar:{name,title,phone,email}, worship_time }
 * content: { message_heading, message, signoff, sundays:[{label, lang, time, note}], events:[…], announcements:[…],
 *            sections:[{heading, body}], include_flyers }
 */
export async function buildNewsletterPdf(nl, church) {
  const pdfMake = await loadPdfMake();
  const c = nl.content || {};
  const flyers = c.include_flyers !== false;
  const body = [];

  // ---------- Masthead ----------
  const titleNode = MALAYALAM.test(nl.title) ? textImage(nl.title, 330, { size: 26, bold: true, color: '#ffffff', margin: [0, 2, 0, 2] }) : { text: nl.title, fontSize: 28, bold: true, color: '#ffffff', margin: [0, 2, 0, 2] };
  body.push({
    table: { widths: ['*'], body: [[{
      fillColor: C.deep, margin: [22, 20, 22, 18],
      columns: [
        { width: '*', stack: [
          { text: 'PARISH NEWSLETTER', fontSize: 8.5, bold: true, color: C.goldSoft, characterSpacing: 2 },
          titleNode,
          { text: church.name, fontSize: 12, color: '#dbe4ee' }
        ] },
        { width: 170, alignment: 'right', fontSize: 8.5, color: '#dbe4ee', lineHeight: 1.25, stack: [
          { text: 'SUNDAY WORSHIP', bold: true, color: C.goldSoft, characterSpacing: 1.5, fontSize: 8 },
          { text: church.worship_time || '10:00 AM', fontSize: 13, bold: true, color: '#ffffff', margin: [0, 1, 0, 6] },
          ...(church.address || '').split(/,\s*(?=[^,]+,\s*[A-Z]{2}\b)|\n/).map((l) => ({ text: l })),
          church.phone ? { text: church.phone } : null
        ].filter(Boolean) }
      ]
    }]] },
    layout: 'noBorders'
  });
  body.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: CONTENT_W, h: 4, color: C.gold }], margin: [0, 0, 0, 4] });

  // ---------- Message ----------
  if (c.message && c.message.trim()) {
    const inner = CONTENT_W - 40;
    body.push(heading(c.message_heading || 'From the Vicar’s desk'));
    body.push({ table: { widths: ['*'], body: [[{ fillColor: C.tint, margin: [18, 14, 18, 10], stack: [
      ...paraBlock(c.message, inner, { size: 11, lineHeight: 1.4, margin: [0, 0, 0, 8] }),
      c.signoff ? para(c.signoff, inner, { size: 10.5, bold: true, color: C.deep, margin: [0, 2, 0, 4] }) : null
    ].filter(Boolean) }]] }, layout: 'noBorders' });
  }

  // ---------- Sundays ----------
  if (c.sundays && c.sundays.length) {
    body.push(heading('Sunday worship this month'));
    body.push({
      table: { headerRows: 1, widths: [96, 128, '*'], body: [
        ['Sunday', 'Service', 'Notes'].map((h) => ({ text: h, bold: true, fontSize: 9, color: C.muted, margin: [0, 2, 0, 2] })),
        ...c.sundays.map((s) => [
          { text: s.label, fontSize: 10, bold: true, margin: [0, 3, 0, 3] },
          { text: s.lang === 'No service' ? 'No service' : `${s.lang} · ${s.time}`, fontSize: 10, margin: [0, 3, 0, 3], color: s.lang === 'No service' ? '#8a2b2b' : C.ink },
          { text: s.note || '', fontSize: 9.5, color: C.muted, margin: [0, 3, 0, 3] }
        ])
      ] },
      layout: { hLineWidth: (i) => (i === 1 ? 1 : 0.5), vLineWidth: () => 0, hLineColor: () => C.line, paddingLeft: () => 4, paddingRight: () => 4 }
    });
  }

  // ---------- Events ----------
  const evs = c.events || [];
  if (evs.length) {
    body.push(heading('Upcoming events'));
    for (const ev of evs) {
      const img = flyers && ev.flyer_url ? await imageData(ev.flyer_url) : null;
      const textW = CONTENT_W - 52 - (img ? 104 : 0);
      const p = parts(ev.starts_at);
      body.push({
        unbreakable: !(ev.description && ev.description.length > 700),
        margin: [0, 0, 0, 12],
        columns: [
          { width: 44, table: { widths: [44], body: [[{ fillColor: C.primary, alignment: 'center', margin: [0, 5, 0, 5], stack: [
            { text: p.mon, fontSize: 8, bold: true, color: C.goldSoft, characterSpacing: 1 },
            { text: p.day, fontSize: 18, bold: true, color: '#ffffff', lineHeight: 1 },
            { text: p.wk, fontSize: 7.5, color: '#dbe4ee' }
          ] }]] }, layout: 'noBorders' },
          { width: '*', margin: [8, 0, 0, 0], stack: [
            para(ev.title, textW, { size: 12, bold: true, color: C.ink, margin: [0, 0, 0, 2] }),
            { text: [ev.when || eventWhen(ev), ev.location ? ` · ${ev.location}` : ''].join(''), fontSize: 9, color: C.muted, margin: [0, 0, 0, 4] },
            ...paraBlock(ev.description, textW, { size: 10, margin: [0, 0, 0, 4] }),
            linkLine(ev.link_url)
          ].filter(Boolean) },
          img ? { width: 96, margin: [8, 0, 0, 0], image: img, fit: [96, 128] } : null
        ].filter(Boolean),
        columnGap: 0
      });
    }
  }

  // ---------- Announcements ----------
  const anns = c.announcements || [];
  if (anns.length) {
    body.push(heading('Announcements'));
    for (const a of anns) {
      const img = flyers && a.flyer_url ? await imageData(a.flyer_url) : null;
      const textW = CONTENT_W - 14 - (img ? 104 : 0);
      body.push({
        unbreakable: !(a.body && a.body.length > 700),
        margin: [0, 0, 0, 12],
        columns: [
          { width: 14, canvas: [{ type: 'rect', x: 0, y: 4, w: 6, h: 6, color: C.gold }] },
          { width: '*', stack: [
            para(a.title, textW, { size: 12, bold: true, margin: [0, 0, 0, 3] }),
            ...paraBlock(a.body, textW, { size: 10, margin: [0, 0, 0, 4] }),
            linkLine(a.link_url)
          ].filter(Boolean) },
          img ? { width: 96, margin: [8, 0, 0, 0], image: img, fit: [96, 128] } : null
        ].filter(Boolean)
      });
    }
  }

  // ---------- Extra sections ----------
  for (const s of (c.sections || []).filter((x) => x.heading || x.body)) {
    if (s.heading) body.push(heading(s.heading));
    body.push(...paraBlock(s.body, CONTENT_W, { size: 10.5, margin: [0, 0, 0, 6] }));
  }

  // ---------- Contact ----------
  const v = church.vicar || {};
  const contactLine = (label, value, link) => value ? { text: [{ text: `${label}  `, bold: true, color: C.deep }, link ? { text: value, link, color: C.link } : { text: value }], fontSize: 9.5, margin: [0, 0, 0, 3] } : null;
  body.push({ margin: [0, 22, 0, 0], unbreakable: true, table: { widths: ['*', '*'], body: [[
    { fillColor: C.tint, margin: [16, 12, 8, 10], stack: [
      { text: 'Stay in touch', fontSize: 12, bold: true, color: C.deep, margin: [0, 0, 0, 6] },
      v.name ? { text: `${v.name}${v.title ? `, ${v.title}` : ''}`, fontSize: 9.5, bold: true, margin: [0, 0, 0, 3] } : null,
      contactLine('Phone', v.phone, v.phone ? `tel:${v.phone.replace(/[^\d+]/g, '')}` : null),
      contactLine('Email', v.email, v.email ? `mailto:${v.email}` : null)
    ].filter(Boolean) },
    { fillColor: C.tint, margin: [8, 12, 16, 10], stack: [
      { text: ' ', fontSize: 12, margin: [0, 0, 0, 6] },
      contactLine('Church office', church.email, church.email ? `mailto:${church.email}` : null),
      contactLine('Website', (church.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''), church.website),
      church.livestream ? contactLine('Watch live', 'YouTube livestream', church.livestream) : null
    ].filter(Boolean) }
  ]] }, layout: 'noBorders' });

  const dd = {
    pageSize: 'LETTER',
    pageMargins: [MARGIN, 44, MARGIN, 56],
    info: { title: `${church.name} — ${nl.title} newsletter`, author: church.name, subject: 'Parish newsletter' },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, color: C.ink },
    content: body,
    footer: (page, pages) => ({
      margin: [MARGIN, 18, MARGIN, 0],
      columns: [
        { text: `${church.name} · ${nl.title}`, fontSize: 8, color: C.muted },
        { text: `Page ${page} of ${pages}`, fontSize: 8, color: C.muted, alignment: 'right' }
      ]
    })
  };
  return new Promise((resolve, reject) => {
    try { pdfMake.createPdf(dd).getBlob((b) => resolve(b)); } catch (e) { reject(e); }
  });
}
