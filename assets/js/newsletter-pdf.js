// Builds the parish newsletter PDF in the browser (Admin → Newsletters), in the same house style as
// the Canva newsletters: running header with the church crest, "MONTHLY NEWSLETTER" cover with the
// church photo and the Vicar's letter, a SUNDAY worship + lectionary table, a calendar table,
// "A Few Notes To Remember", birthday and anniversary boxes, flyer pages and a photo "Quick Glimpse".
// Text is real PDF text (sharp, searchable, clickable links). Malayalam is drawn by the browser
// first and placed as an image, because PDF fonts can't shape Malayalam script.

const PDFMAKE = 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/';
const ASSETS = new URL('../newsletter/', import.meta.url).href;
const C = {
  paper: '#f6f3ee', paper2: '#ece6dd', ink: '#1d1915', muted: '#5a5048', rule: '#1d1915',
  tan: '#d9c4a4', brown: '#8a5a2c', dark: '#3a2a1d', cream: '#fdf8ee', boxLine: '#dcc29c', link: '#6b4220', white: '#ffffff'
};
const PAGE_W = 612, PAGE_H = 792, MARGIN = 44, CONTENT_W = PAGE_W - MARGIN * 2;
const MALAYALAM = /[ഀ-ൿ]/;
const TZ = 'America/New_York';
const FONT_FILES = {
  Tinos: { normal: 'Tinos-Regular.ttf', bold: 'Tinos-Bold.ttf', italics: 'Tinos-Italic.ttf', bolditalics: 'Tinos-BoldItalic.ttf' },
  Playfair: { normal: 'PlayfairDisplay-Regular.ttf', bold: 'PlayfairDisplay-Bold.ttf', italics: 'PlayfairDisplay-Regular.ttf', bolditalics: 'PlayfairDisplay-Bold.ttf' }
};

/* ---------- loading ---------- */
let loader = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the PDF tools. Check your internet connection and try again.'));
    document.head.appendChild(s);
  });
}
async function toB64(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function loadPdfMake() {
  loader ||= (async () => {
    if (!window.pdfMake) await loadScript(PDFMAKE + 'pdfmake.min.js');
    const pm = window.pdfMake;
    const files = [...new Set(Object.values(FONT_FILES).flatMap((f) => Object.values(f)))];
    const vfs = {};
    await Promise.all(files.map(async (f) => {
      const r = await fetch(ASSETS + 'fonts/' + f);
      if (!r.ok) throw new Error('Could not load the newsletter fonts.');
      vfs[f] = await toB64(await r.arrayBuffer());
    }));
    if (typeof pm.addVirtualFileSystem === 'function') pm.addVirtualFileSystem(vfs); else pm.vfs = { ...(pm.vfs || {}), ...vfs };
    if (typeof pm.addFonts === 'function') pm.addFonts(FONT_FILES); else pm.fonts = { ...(pm.fonts || {}), ...FONT_FILES };
    return pm;
  })().catch((e) => { loader = null; throw e; });
  return loader;
}

/* ---------- helpers ---------- */
const fmtDate = (iso, o) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...o });
export function eventWhen(ev) {
  const day = fmtDate(ev.starts_at, { weekday: 'long', month: 'long', day: 'numeric' });
  if (ev.all_day) {
    if (ev.ends_at && fmtDate(ev.ends_at, { dateStyle: 'short' }) !== fmtDate(ev.starts_at, { dateStyle: 'short' })) return `${day} – ${fmtDate(ev.ends_at, { weekday: 'long', month: 'long', day: 'numeric' })}`;
    return day;
  }
  const t = (iso) => fmtDate(iso, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${t(ev.starts_at)}${ev.ends_at ? ` – ${t(ev.ends_at)}` : ''}`;
}
/** "Friday, November 6, 2026 at 7:30 pm" — the timing style used in past newsletters. */
function timing(ev) {
  const day = fmtDate(ev.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (ev.all_day) return day;
  const t = (iso) => fmtDate(iso, { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
  return `${day} at ${t(ev.starts_at)}${ev.ends_at && fmtDate(ev.ends_at, { dateStyle: 'short' }) === fmtDate(ev.starts_at, { dateStyle: 'short' }) ? ` – ${t(ev.ends_at)}` : ''}`;
}
const paras = (text) => String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const linkify = (line, color = C.link) => {
  const parts = []; let last = 0;
  String(line).replace(/(https?:\/\/[^\s]+|[\w.+-]+@[\w-]+\.[\w.]+)/g, (m, _x, i) => {
    if (i > last) parts.push(line.slice(last, i));
    parts.push({ text: m, link: m.includes('@') && !m.startsWith('http') ? `mailto:${m}` : m, color });
    last = i + m.length; return m;
  });
  if (last < line.length) parts.push(line.slice(last));
  return parts.length ? parts : [line];
};

/** Draw text (any script) onto a canvas, wrapped to `width` points; returns a pdfmake image node. */
function textImage(text, width, { size = 10.5, bold = false, color = C.ink, lineHeight = 1.45, align = 'left', margin = [0, 0, 0, 6] } = {}) {
  const scale = 3;
  const font = `${bold ? '700 ' : ''}${size * scale}px "Noto Serif Malayalam", "Noto Sans Malayalam", "Nirmala UI", "Kartika", "Manjari", serif`;
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
  g.font = font; g.fillStyle = color; g.textBaseline = 'top'; g.textAlign = align === 'center' ? 'center' : 'left';
  lines.forEach((l, i) => g.fillText(l, align === 'center' ? c.width / 2 : 0, i * lh + size * 0.15 * scale));
  return { image: c.toDataURL('image/png'), width, margin };
}
/** A paragraph as PDF text, or as an image when it contains Malayalam. */
function para(text, width, s = {}) {
  if (MALAYALAM.test(text)) return textImage(text, width, s);
  return { text: s.links === false ? text : linkify(text), fontSize: s.size || 10.5, bold: !!s.bold, italics: !!s.italics, color: s.color || C.ink, lineHeight: s.lineHeight || 1.3, alignment: s.align || 'left', margin: s.margin || [0, 0, 0, 6], font: s.font };
}
const paraBlock = (text, width, s) => paras(text).map((p) => para(p, width, s));

/** Fetch an image and return a data URL; optionally centre-crop to an aspect ratio (w/h). */
async function imageData(url, { maxSide = 1400, aspect = null, quality = 0.85 } = {}) {
  if (!url) return null;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const blob = await r.blob();
    const bmp = await createImageBitmap(blob);
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (aspect) {
      if (sw / sh > aspect) { const nw = sh * aspect; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / aspect; sy = (sh - nh) / 2; sh = nh; }
    }
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext('2d');
    const png = /png/.test(blob.type) && !aspect;
    if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality);
  } catch (e) { return null; }
}

/* ---------- building blocks ---------- */
const pageBreak = (node) => ({ ...node, pageBreak: 'before' });

/** Big banner: the "SUNDAY" / "Pray" picture headers of past issues, done as type on a dark band. */
function banner(word, sub) {
  return {
    table: { widths: ['*'], body: [[{
      fillColor: C.dark, margin: [0, 14, 0, 12], alignment: 'center', stack: [
        { text: word, font: 'Playfair', bold: true, fontSize: 54, color: C.tan, characterSpacing: 4, lineHeight: 0.95 },
        sub ? { text: sub.toUpperCase(), fontSize: 8.5, color: '#e9dcc6', characterSpacing: 2.5, margin: [0, 4, 0, 0] } : null
      ].filter(Boolean)
    }]] },
    layout: 'noBorders', margin: [0, 0, 0, 0]
  };
}
function title(text, { size = 22, underline = false, margin = [0, 6, 0, 12] } = {}) {
  if (MALAYALAM.test(text)) return textImage(text, CONTENT_W, { size: size * 0.8, bold: true, align: 'center', margin });
  return { text, font: 'Playfair', bold: true, fontSize: size, alignment: 'center', decoration: underline ? 'underline' : undefined, margin, color: C.ink };
}
/** Bordered table with the tan header row used in the past issues. */
function boxTable(headers, widths, rows) {
  return {
    table: {
      headerRows: 1, widths, dontBreakRows: true,
      body: [
        headers.map((h) => ({ text: h, bold: true, fontSize: 8.5, fillColor: C.tan, alignment: 'center', margin: [2, 7, 2, 7], characterSpacing: 0.4 })),
        ...rows.map((r) => r.map((cell) => ({ fillColor: C.white, alignment: 'center', margin: [4, 7, 4, 7], fontSize: 9.5, lineHeight: 1.2, ...(typeof cell === 'string' ? { text: cell } : cell) })))
      ]
    },
    layout: { hLineWidth: () => 0.8, vLineWidth: () => 0.8, hLineColor: () => C.rule, vLineColor: () => C.rule, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 }
  };
}
/** Rounded cream boxes (birthdays / anniversaries), `cols` per row. */
function boxGrid(items, cols) {
  const gap = 14, w = (CONTENT_W - gap * (cols - 1)) / cols;
  const charsPerLine = cols === 3 ? 30 : 48;
  const lineCount = (it) => 1 + it.names.reduce((n, nm) => n + Math.max(1, Math.ceil(nm.length / charsPerLine)), 0);
  const rows = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return rows.map((row) => {
    const h = Math.max(cols === 3 ? 74 : 54, 18 + Math.max(...row.map(lineCount)) * 12.6);
    return {
      columns: row.map((it) => ({
        width: w,
        stack: [
          { canvas: [{ type: 'rect', x: 0, y: 0, w, h, r: 10, color: C.cream, lineColor: C.boxLine, lineWidth: 1 }] },
          { margin: [6, -h, 6, 0], table: { widths: [w - 12], heights: [h], body: [[{ alignment: 'center', margin: [0, 9, 0, 6], stack: [
            { text: String(it.day), bold: true, fontSize: 9.5, margin: [0, 0, 0, 3] },
            ...it.names.map((nm) => MALAYALAM.test(nm) ? textImage(nm, w - 16, { size: 9, bold: true, align: 'center', margin: [0, 0, 0, 1] }) : { text: nm, bold: true, fontSize: 9, lineHeight: 1.15 })
          ] }]] }, layout: 'noBorders' }
        ]
      })).concat(row.length < cols ? Array(cols - row.length).fill({ width: w, text: '' }) : []),
      columnGap: gap, margin: [0, 0, 0, 12], unbreakable: true
    };
  });
}

/**
 * nl: { title, content }   church: { name, address, phone, email, website, livestream, vicar }
 * content: see nlCollect() in admin.js
 */
export async function buildNewsletterPdf(nl, church) {
  const pdfMake = await loadPdfMake();
  const c = nl.content || {};
  const issue = String(nl.title || '').toUpperCase();
  const [logo, cover] = await Promise.all([
    imageData(ASSETS + 'logo.png', { maxSide: 200 }),
    imageData(c.cover_url || ASSETS + 'church.jpg', { aspect: CONTENT_W / 180, maxSide: 1600 })
  ]);
  const body = [];

  // ---------- Cover + letter ----------
  body.push({
    margin: [0, 2, 0, 6], alignment: 'center',
    columns: [
      { width: '*', text: '' },
      { width: 'auto', text: '»', font: 'Playfair', bold: true, fontSize: 26, margin: [0, -4, 6, 0] },
      { width: 'auto', table: { body: [[{ text: 'MONTHLY', font: 'Playfair', fontSize: 11, color: '#f3e6cf', fillColor: C.brown, margin: [8, 2, 8, 1], characterSpacing: 1 }]] }, layout: 'noBorders', margin: [0, 4, 0, 0] },
      { width: 'auto', text: '«', font: 'Playfair', bold: true, fontSize: 26, margin: [6, -4, 0, 0] },
      { width: '*', text: '' }
    ]
  });
  body.push({ text: 'NEWSLETTER', font: 'Playfair', fontSize: 30, alignment: 'center', characterSpacing: 1, margin: [0, 0, 0, 10] });
  if (cover) body.push({ image: cover, width: CONTENT_W, height: 180, margin: [0, 0, 0, 14] });
  if (c.message_heading) body.push(title(c.message_heading, { size: 15, margin: [0, 0, 0, 8] }));
  if (c.message && c.message.trim()) {
    body.push(...paraBlock(c.message, CONTENT_W, { size: 10.5, lineHeight: 1.32, align: 'justify', margin: [0, 0, 0, 9] }));
  }
  if (c.signoff && c.signoff.trim()) {
    body.push({ margin: [0, 6, 0, 0], stack: c.signoff.split('\n').map((l) => para(l.trim() || ' ', CONTENT_W, { size: 10.5, margin: [0, 0, 0, 1] })) });
  }

  // ---------- SUNDAY ----------
  const sundays = c.sundays || [];
  if (sundays.length) {
    body.push(pageBreak(banner('SUNDAY', 'Worship schedule & lectionary')));
    const rows = sundays.map((s) => {
      const worship = s.lang === 'No service'
        ? [{ text: 'NO SERVICE', bold: true }, s.special ? `(${s.special})` : ''].filter(Boolean)
        : [{ text: String(s.service || 'Holy Communion').toUpperCase(), bold: false }, s.date_long || s.label,
           ...(Array.isArray(s.services) && s.services.length ? s.services.map((x) => `${x.time} (${x.language})`) : [`(${s.lang})`, s.time]),
           s.special ? `(${s.special})` : ''].filter(Boolean);
      const lect = [s.lesson1 && `LESSON 1: ${s.lesson1}`, s.lesson2 && `LESSON 2: ${s.lesson2}`, s.epistle && `EPISTLE: ${s.epistle}`, s.gospel && `GOSPEL: ${s.gospel}`].filter(Boolean);
      return [
        { stack: worship.map((t) => (typeof t === 'string' ? { text: t } : t)) },
        { stack: lect.length ? lect.map((t) => ({ text: t })) : [{ text: '—', color: C.muted }] },
        MALAYALAM.test(s.support || '') ? textImage(s.support, 100, { size: 9, align: 'center', margin: [0, 0, 0, 0] }) : { text: s.support || '' }
      ];
    });
    body.push(boxTable(['WORSHIP SCHEDULE', 'LECTIONARY', 'SERVICE\nSUPPORT'], [168, '*', 108], rows));
    if (c.sunday_note) body.push({ margin: [0, 10, 0, 0], table: { widths: ['*'], body: [[{ fillColor: C.dark, color: '#f3e6cf', fontSize: 9.5, alignment: 'center', margin: [10, 7, 10, 7], stack: [{ text: 'Note:', bold: true, margin: [0, 0, 0, 2] }, ...paraBlock(c.sunday_note, CONTENT_W - 30, { size: 9.5, color: '#f3e6cf', align: 'center', margin: [0, 0, 0, 2], links: false })] }]] }, layout: 'noBorders' });
  }

  // ---------- Calendar (organization meetings & events) ----------
  const evs = c.events || [];
  if (evs.length) {
    body.push(pageBreak(banner(c.calendar_word || 'CALENDAR', 'Meetings, fellowships & events')));
    body.push(boxTable(['ORGANIZATION /\nMEETING', 'TIMING', 'VENUE'], [150, 170, '*'], evs.map((ev) => [
      { stack: [para(ev.title, 140, { size: 9.5, bold: false, align: 'center', margin: [0, 0, 0, 0], links: false }),
        ev.description ? para(ev.description.length > 160 ? ev.description.slice(0, 157).trim() + '…' : ev.description, 140, { size: 8, italics: true, color: C.muted, align: 'center', margin: [0, 3, 0, 0] }) : null].filter(Boolean) },
      { text: timing(ev) },
      { stack: [para(ev.location || '', 170, { size: 9.5, align: 'center', margin: [0, 0, 0, 0], links: false }), ev.link_url ? { text: 'Details & registration', link: ev.link_url, color: C.link, decoration: 'underline', fontSize: 8, margin: [0, 3, 0, 0] } : null].filter(Boolean) }
    ])));
  }

  // ---------- A Few Notes To Remember (announcements + standing notes) ----------
  const anns = c.announcements || [];
  const secs = (c.sections || []).filter((s) => s.heading || s.body);
  if (anns.length || secs.length) {
    const notes = [title('A Few Notes To Remember', { size: 17, underline: true, margin: [0, 0, 0, 10] })];
    {
      for (const a of anns) {
        notes.push({ unbreakable: true, margin: [24, 0, 24, 10], stack: [
          para(a.title, CONTENT_W - 48, { size: 11.5, bold: true, align: 'center', margin: [0, 0, 0, 3], links: false }),
          ...paraBlock(a.body, CONTENT_W - 48, { size: 10, align: 'center', margin: [0, 0, 0, 3] }),
          a.link_url ? { text: [{ text: 'More details: ', color: C.muted }, { text: a.link_url.replace(/^https?:\/\//, '').replace(/\/$/, ''), link: a.link_url, color: C.link }], fontSize: 9, alignment: 'center' } : null
        ].filter(Boolean) });
      }
    }
    for (const s of secs) {
      notes.push({ unbreakable: (s.body || '').length < 900, margin: [0, 8, 0, 0], stack: [
        s.heading ? title(s.heading, { size: 15, underline: true, margin: [0, 0, 0, 8] }) : null,
        ...String(s.body || '').replace(/\r/g, '').split('\n').map((l) => para(l.trim() || ' ', CONTENT_W - 40, { size: 10, align: 'center', margin: [20, 0, 20, 2] }))
      ].filter(Boolean) });
    }
    notes[0] = pageBreak(notes[0]);
    body.push(...notes);
  }

  // ---------- Birthdays & anniversaries ----------
  const month = c.people_month || String(nl.title || '').replace(/\s*\d{4}\s*$/, '');
  if (c.birthdays && c.birthdays.length) {
    body.push(pageBreak(title(`${month} Birthdays`, { size: 24, margin: [0, 0, 0, 14] })));
    body.push(...boxGrid(c.birthdays, 3));
  }
  if (c.anniversaries && c.anniversaries.length) {
    const t = title(`${month} Anniversaries`, { size: 24, margin: [0, c.birthdays && c.birthdays.length ? 0 : 0, 0, 14] });
    body.push(pageBreak(t));
    body.push(...boxGrid(c.anniversaries, 2));
  }

  // ---------- Flyer pages ----------
  if (c.include_flyers !== false) {
    const flyers = [...evs, ...anns].filter((x) => x.flyer_url);
    if (flyers.length) {
      const imgs = (await Promise.all(flyers.map((f) => imageData(f.flyer_url, { maxSide: 1500 })))).filter(Boolean);
      const w = (CONTENT_W - 18) / 2;
      for (let i = 0; i < imgs.length; i += 4) {
        const page = imgs.slice(i, i + 4);
        const rows = [];
        for (let j = 0; j < page.length; j += 2) rows.push({ columns: page.slice(j, j + 2).map((im) => ({ width: w, image: im, fit: [w, 300], alignment: 'center' })).concat(page.length - j === 1 ? [{ width: w, text: '' }] : []), columnGap: 18, margin: [0, 0, 0, 16] });
        body.push(pageBreak({ stack: [title(i === 0 ? 'Upcoming Events' : 'Upcoming Events (continued)', { size: 20, margin: [0, 0, 0, 12] }), ...rows] }));
      }
    }
  }

  // ---------- Quick Glimpse ----------
  const photos = c.glimpse_photos || [];
  if (photos.length) {
    const w = (CONTENT_W - 30) / 2, h = Math.round(w * 0.72);
    const imgs = (await Promise.all(photos.map((p) => imageData(p.url, { aspect: w / h, maxSide: 900, quality: 0.8 })))).filter(Boolean);
    const rows = [];
    for (let j = 0; j < imgs.length; j += 2) rows.push({ columns: imgs.slice(j, j + 2).map((im) => ({ width: w, image: im, fit: [w, h] })).concat(imgs.length - j === 1 ? [{ width: w, text: '' }] : []), columnGap: 30, margin: [0, 0, 0, 16], unbreakable: true });
    body.push(pageBreak(title(c.glimpse_title || 'Quick Glimpse', { size: 22, margin: [0, 0, 0, 4] })));
    if (c.glimpse_subtitle) body.push(para(c.glimpse_subtitle.toUpperCase(), CONTENT_W, { size: 11, bold: true, align: 'center', margin: [0, 0, 0, 14], links: false }));
    else body.push({ text: '', margin: [0, 0, 0, 10] });
    body.push(...rows);
  }

  const dd = {
    pageSize: 'LETTER',
    pageMargins: [MARGIN, 78, MARGIN, 40],
    info: { title: `${church.name} — ${nl.title} newsletter`, author: church.name, subject: 'Parish newsletter' },
    defaultStyle: { font: 'Tinos', fontSize: 10.5, color: C.ink },
    background: () => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: PAGE_W, h: PAGE_H, linearGradient: [C.paper, C.paper2] }] }),
    header: () => ({
      margin: [MARGIN, 24, MARGIN, 0],
      stack: [
        { columns: [
          logo ? { width: 30, image: logo, fit: [30, 30] } : { width: 0, text: '' },
          { width: '*', text: (church.name || 'Mar Thoma Church, Atlanta').toUpperCase(), fontSize: 11.5, characterSpacing: 0.6, margin: [7, 10, 0, 0] },
          { width: 'auto', text: issue, fontSize: 11.5, characterSpacing: 0.6, margin: [0, 10, 0, 0] }
        ] },
        { canvas: [
          { type: 'line', x1: 0, y1: 5, x2: CONTENT_W, y2: 5, lineWidth: 1.2, lineColor: C.rule },
          { type: 'line', x1: 0, y1: 8, x2: CONTENT_W, y2: 8, lineWidth: 0.5, lineColor: C.rule }
        ] }
      ]
    }),
    footer: (page, pages) => (pages > 1 ? { text: `${page}`, alignment: 'center', fontSize: 8, color: C.muted, margin: [0, 14, 0, 0] } : null),
    content: body
  };
  return new Promise((resolve, reject) => {
    try { pdfMake.createPdf(dd).getBlob((b) => resolve(b)); } catch (e) { reject(e); }
  });
}
