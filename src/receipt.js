// Sale receipt (PDF), order-history report (PDF + CSV), price helpers and WhatsApp messages.
// Pure functions with no imports, so they also run in Node tests. PDFs are built here with no library:
// A4, standard Helvetica fonts, Latin-1 text (other characters print as '?').
// Payment happens outside the site, so receipts and reports record what the seller confirmed and do not prove payment.

const BN_TZ = 'Asia/Brunei';
export const waUrl = (num, text) => `https://wa.me/${String(num || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
const money = (n) => `BND ${Number(n).toFixed(2)}`;
const fmtDate = (v, withTime) => {
  if (!v) return null;
  const d = new Date(v); if (Number.isNaN(+d)) return null;
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: BN_TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  if (!withTime) return date;
  return `${date}, ${new Intl.DateTimeFormat('en-GB', { timeZone: BN_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)} GMT+8`;
};

export function listingUrl(id) { return `${location.origin}${location.pathname}#/listing/${id}`; }

// ---------- prices: the listing price, and the agreed sale price when the seller entered one ----------
export const listPrice = (l) => (l.type === 'auction' ? Number(l.current_bid ?? l.start_price) : Number(l.price));
export const finalPrice = (l) => (l.agreed_price != null ? Number(l.agreed_price) : listPrice(l));
export function priceDiff(l) {
  const listing = listPrice(l), final = finalPrice(l), delta = Math.round((final - listing) * 100) / 100;
  return { listing, final, delta, pct: listing ? (delta / listing) * 100 : 0, changed: delta !== 0 };
}
// "- BND 5.00 (-4.0%)" or "+ BND 5.00 (+4.0%)"
export const fmtDelta = (x) => `${x.delta < 0 ? '-' : '+'} ${money(Math.abs(x.delta))} (${x.pct < 0 ? '-' : '+'}${Math.abs(x.pct).toFixed(1)}%)`;

export function receiptData(l, name) {
  const when = l.sold_at || l.created_at;
  const ymd = (() => { const d = new Date(when); return Number.isNaN(+d) ? '00000000' : new Intl.DateTimeFormat('en-CA', { timeZone: BN_TZ }).format(d).replace(/-/g, ''); })();
  const pd = priceDiff(l);
  return {
    no: `RCP-${ymd}-${String(l.id).replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    id: l.id, code: l.card_code, name: name || l.card_name, rarity: l.rarity || '-', cond: l.condition, lang: l.language || '-',
    price: pd.final, listing: pd.listing, changed: pd.changed, delta: pd.delta, pct: pd.pct, type: l.type,
    seller: l.seller?.display_name || 'Seller', buyer: l.buyer?.display_name || 'Buyer', soldAt: l.sold_at || null,
    url: typeof location !== 'undefined' ? listingUrl(l.id) : '',
  };
}

// buyer -> seller, right after Buy now
export const msgInformSeller = (d) => `Hi ${d.seller}, I ${d.type === 'auction' ? 'won your auction for' : 'clicked Buy now on One Piece TCG for'} ${d.code} ${d.name} (${d.cond}) at ${money(d.price)}. Please keep it on hold for me.\nListing: ${d.url}\nWhen and where can we meet?`;
// seller -> buyer, after Sold
export const msgInformBuyer = (d) => `Hi ${d.buyer}, thank you! Your purchase of ${d.code} ${d.name} (${money(d.price)}${d.changed ? `, agreed price; listing price ${money(d.listing)}` : ''}) is now marked as sold and complete.\nReceipt no. ${d.no}. I am sending you the PDF receipt in this chat.\nListing: ${d.url}`;

// ---------- PDF building blocks ----------
const esc = (s) => String(s ?? '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const wrap = (s, n) => { const out = []; let cur = ''; for (const w of String(s).split(/\s+/)) { if ((cur + ' ' + w).trim().length > n) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; };
// approximate Helvetica widths (em) for right-aligning numbers and trimming text
const CW = { ' ': .278, '.': .278, ',': .278, ':': .278, '/': .278, '-': .333, '(': .333, ')': .333, '+': .584, '%': .889, '*': .389, B: .667, N: .722, D: .722 };
for (const c of '0123456789') CW[c] = .556;
const tw = (s, size) => { let w = 0; for (const ch of String(s)) w += CW[ch] ?? .56; return w * size; };
const fit = (s, maxw, size) => { s = String(s ?? ''); if (tw(s, size) <= maxw) return s; while (s.length > 1 && tw(s + '..', size) > maxw) s = s.slice(0, -1); return s.trimEnd() + '..'; };
const textOp = (x, y, size, text, bold, gray) => `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray} g ${x} ${y} Td (${esc(text)}) Tj ET`;

function buildPdf(contents) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  contents.forEach((c, i) => {
    kids.push(`${5 + i * 2} 0 R`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${contents.length} >>`;
  let pdf = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
  return new Blob([bytes], { type: 'application/pdf' });
}

// ---------- one-page sale receipt ----------
export function receiptPdf(d) {
  const ops = [];
  const T = (x, y, size, text, bold, gray) => ops.push(textOp(x, y, size, text, bold, gray));
  const hr = (y) => ops.push(`0.82 G 0.6 w 40 ${y} m 555 ${y} l S`);
  ops.push('0.788 0.145 0.196 rg 0 770 595 72 re f');
  T(40, 808, 22, 'One Piece TCG', true, 1); T(40, 788, 11, 'Sale receipt', false, 1);
  T(360, 808, 9, 'Receipt no.', false, 1); T(360, 793, 13, d.no, true, 1);
  let y = 735;
  const row = (label, value, size = 12, bold = false) => { T(40, y, 8.5, label.toUpperCase(), false, 0.45); T(40, y - 16, size, value, bold, 0); y -= 46; };
  row('Receipt issued', fmtDate(new Date(), true));
  row('Sale marked as sold by the seller', fmtDate(d.soldAt, true) || 'Date not recorded for this sale');
  hr(y + 22);
  T(40, y - 6, 8.5, 'SELLER', false, 0.45); T(300, y - 6, 8.5, 'BUYER', false, 0.45);
  T(40, y - 22, 13, d.seller, true, 0); T(300, y - 22, 13, d.buyer, true, 0); y -= 62; hr(y + 30);
  row('Item', `${d.code}  ${d.name}`, 13, true);
  T(40, y + 8, 8.5, 'RARITY', false, 0.45); T(200, y + 8, 8.5, 'CONDITION', false, 0.45); T(330, y + 8, 8.5, 'LANGUAGE', false, 0.45); T(450, y + 8, 8.5, 'SOLD AS', false, 0.45);
  T(40, y - 8, 12, d.rarity, false, 0); T(200, y - 8, 12, d.cond, false, 0); T(330, y - 8, 12, d.lang, false, 0); T(450, y - 8, 12, d.type === 'auction' ? 'Auction' : 'Buy now', false, 0);
  y -= 46; hr(y + 24);
  T(40, y - 4, 8.5, d.changed ? 'AGREED SALE PRICE' : 'AMOUNT AGREED', false, 0.45); T(40, y - 30, 24, money(d.price), true, 0);
  if (d.changed) T(40, y - 50, 10, `Listing price ${money(d.listing)}   |   ${fmtDelta(d)} from listing price`, false, 0.25);
  y -= d.changed ? 88 : 70; hr(y + 30);
  T(40, y, 8.5, 'PAYMENT AND HAND-OVER', false, 0.45);
  wrap('Arranged and completed directly between the buyer and the seller, outside this site.', 95).forEach((ln, i) => T(40, y - 16 - i * 14, 11, ln, false, 0));
  y -= 62;
  T(40, y, 8.5, 'LISTING', false, 0.45); T(40, y - 14, 9, d.url, false, 0.2);
  ['This receipt was generated from the seller\'s confirmation on the One Piece TCG marketplace.',
    'The site does not take, hold or verify payments, so this receipt is a record of the sale as confirmed by the seller.',
    'Keep it with your own proof of payment. Times are shown in Brunei time (GMT+8).'].forEach((ln, i) => T(40, 70 - i * 12, 8, ln, false, 0.4));
  return buildPdf([ops.join('\n')]);
}

// ---------- order-history report (completed orders only) ----------
export function reportModel(rows, role, nameOf) {
  const lines = rows.map((l) => {
    const pd = priceDiff(l), when = l.sold_at || l.created_at;
    return { when, legacy: !l.sold_at, no: receiptData(l).no, code: l.card_code, name: nameOf ? nameOf(l) : l.card_name, rarity: l.rarity || '', cond: l.condition || '',
      who: role === 'sell' ? (l.buyer?.display_name || '') : (l.seller?.display_name || ''), listing: pd.listing, final: pd.final, delta: pd.delta, pct: pd.pct, changed: pd.changed };
  }).sort((a, b) => new Date(b.when) - new Date(a.when));
  const sum = { n: lines.length, listing: 0, final: 0, delta: 0, pct: 0, below: 0, same: 0, above: 0, legacy: 0 };
  for (const x of lines) { sum.listing += x.listing; sum.final += x.final; x.delta < 0 ? sum.below++ : x.delta > 0 ? sum.above++ : sum.same++; if (x.legacy) sum.legacy++; }
  sum.listing = Math.round(sum.listing * 100) / 100; sum.final = Math.round(sum.final * 100) / 100;
  sum.delta = Math.round((sum.final - sum.listing) * 100) / 100; sum.pct = sum.listing ? (sum.delta / sum.listing) * 100 : 0;
  return { lines, sum, role };
}

const num2 = (n) => Number(n).toFixed(2);
const sgn2 = (n) => (n === 0 ? '0.00' : (n < 0 ? '-' : '+') + Math.abs(n).toFixed(2));
const sgnPct = (p) => (Math.abs(p) < 0.05 ? '0.0%' : (p < 0 ? '-' : '+') + Math.abs(p).toFixed(1) + '%');

export function reportCsv(m) {
  const safe = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const who = m.role === 'sell' ? 'Buyer' : 'Seller';
  const head = ['Date', 'Receipt no', 'Card code', 'Card name', 'Rarity', 'Condition', who, 'Listing price (BND)', 'Final price (BND)', 'Difference (BND)', 'Difference (%)', 'Date note'];
  const out = [head.map(safe).join(',')];
  for (const x of m.lines) out.push([safe(fmtDate(x.when, false) || ''), safe(x.no), safe(x.code), safe(x.name), safe(x.rarity), safe(x.cond), safe(x.who),
    num2(x.listing), num2(x.final), sgn2(x.delta), (Math.abs(x.pct) < 0.05 ? 0 : x.pct).toFixed(1), safe(x.legacy ? 'Sale date not recorded, listing date shown' : '')].join(','));
  return out.join('\r\n') + '\r\n';
}

export function reportPdf(m, meta) {
  const pages = []; let ops;
  const T = (x, y, size, text, bold, gray) => ops.push(textOp(x, y, size, text, bold, gray));
  const TR = (xr, y, size, text, bold, gray) => T((xr - tw(text, size)).toFixed(1), y, size, text, bold, gray);
  const who = m.role === 'sell' ? 'Buyer' : 'Seller';
  const colHead = (y) => {
    ops.push(`0.93 g 40 ${y - 5} 515 16 re f`);
    T(44, y, 8, 'DATE', true, 0.25); T(106, y, 8, 'CARD', true, 0.25); T(262, y, 8, who.toUpperCase(), true, 0.25);
    TR(420, y, 8, 'LISTING', true, 0.25); TR(475, y, 8, 'FINAL', true, 0.25); TR(520, y, 8, 'DIFF', true, 0.25); TR(555, y, 8, 'DIFF %', true, 0.25);
  };
  const s = m.sum;
  // page 1: header, who/period, summary
  ops = []; pages.push(ops);
  ops.push('0.788 0.145 0.196 rg 0 770 595 72 re f');
  T(40, 808, 22, 'One Piece TCG', true, 1); T(40, 788, 11, meta.title, false, 1);
  T(360, 808, 9, 'Period', false, 1); T(360, 793, 12, fit(meta.period, 190, 12), true, 1);
  T(40, 744, 9, `Prepared for: ${meta.who || '-'}`, false, 0.2); T(40, 730, 9, `Generated: ${fmtDate(new Date(), true)}`, false, 0.2);
  ops.push('0.82 G 0.6 w 40 718 m 555 718 l S');
  const box = (x, label, value, sub) => { T(x, 696, 8, label.toUpperCase(), false, 0.45); T(x, 676, 15, value, true, 0); if (sub) T(x, 662, 8.5, sub, false, 0.4); };
  box(40, 'Completed orders', String(s.n), `${s.below} below, ${s.same} at, ${s.above} above listing price`);
  box(190, 'Total listing price', money(s.listing));
  box(340, m.role === 'sell' ? 'Total sales' : 'Total spent', money(s.final));
  box(450, 'Net vs listing prices', s.delta === 0 ? 'At listing' : `${s.delta < 0 ? '-' : '+'} ${money(Math.abs(s.delta))}`, s.delta === 0 ? '' : sgnPct(s.pct));
  ops.push('0.82 G 0.6 w 40 644 m 555 644 l S');
  let y = 624; colHead(y); y -= 20;
  m.lines.forEach((x, i) => {
    if (y < 62) { ops = []; pages.push(ops); y = 780; T(40, 812, 9, `${meta.title}  (continued)`, true, 0.3); colHead(y); y -= 20; }
    if (i % 2 === 1) ops.push(`0.975 g 40 ${y - 4} 515 14 re f`);
    T(44, y, 8.5, fmtDate(x.when, false) + (x.legacy ? '*' : ''), false, 0);
    T(106, y, 8.5, fit(`${x.code}  ${x.name}`, 150, 8.5), false, 0);
    T(262, y, 8.5, fit(x.who, 100, 8.5), false, 0);
    TR(420, y, 8.5, num2(x.listing), false, 0); TR(475, y, 8.5, num2(x.final), x.changed, 0); TR(520, y, 8.5, sgn2(x.delta), false, x.delta ? 0.15 : 0.55); TR(555, y, 8.5, sgnPct(x.pct), false, x.delta ? 0.15 : 0.55);
    y -= 15;
  });
  const foot = ['Amounts are the prices recorded by the seller on One Piece TCG; FINAL is the agreed sale price, or the listing price when none was entered.',
    'The site does not take, hold or verify payments. DIFF compares the final price with the listing price. Amounts in BND, dates in Brunei time (GMT+8).'];
  if (s.legacy) foot.unshift(`* Sale date not recorded for ${s.legacy} older order${s.legacy > 1 ? 's' : ''}; the listing date is shown.`);
  pages.forEach((p, i) => {
    foot.forEach((ln, k) => p.push(textOp(40, 46 - k * 10, 7, ln, false, 0.45)));
    p.push(textOp(500, 12, 8, `Page ${i + 1} of ${pages.length}`, false, 0.4));
  });
  return buildPdf(pages.map((p) => p.join('\n')));
}

// ---------- downloads ----------
export function downloadBlob(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
export const downloadText = (name, text, mime = 'text/csv') => downloadBlob(name, new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' }));
export function downloadReceipt(d) { downloadBlob(`Receipt-${d.no}.pdf`, receiptPdf(d)); }
export function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'application/pdf' })], 'r.pdf', { type: 'application/pdf' })] })); } catch { return false; }
}
export async function shareReceipt(d) {
  const file = new File([receiptPdf(d)], `Receipt-${d.no}.pdf`, { type: 'application/pdf' });
  await navigator.share({ files: [file], title: `Receipt ${d.no}`, text: `Receipt ${d.no}: ${d.code} ${d.name}, ${money(d.price)}` });
}
