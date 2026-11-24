// Sale receipt (PDF) and WhatsApp messages for the buy-now hold flow.
// The PDF is built here with no library: one A4 page, standard Helvetica fonts, Latin-1 text.
// Payment happens outside the site, so the receipt records the seller's confirmation and does not prove payment.

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

export function receiptData(l, name) {
  const when = l.sold_at || l.created_at;
  const ymd = (() => { const d = new Date(when); return Number.isNaN(+d) ? '00000000' : new Intl.DateTimeFormat('en-CA', { timeZone: BN_TZ }).format(d).replace(/-/g, ''); })();
  return {
    no: `RCP-${ymd}-${String(l.id).replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    id: l.id, code: l.card_code, name: name || l.card_name, rarity: l.rarity || '-', cond: l.condition, lang: l.language || '-',
    price: l.type === 'auction' ? Number(l.current_bid ?? l.start_price) : Number(l.price), type: l.type,
    seller: l.seller?.display_name || 'Seller', buyer: l.buyer?.display_name || 'Buyer', soldAt: l.sold_at || null,
    url: typeof location !== 'undefined' ? listingUrl(l.id) : '',
  };
}

// buyer -> seller, right after Buy now
export const msgInformSeller = (d) => `Hi ${d.seller}, I ${d.type === 'auction' ? 'won your auction for' : 'clicked Buy now on One Piece TCG for'} ${d.code} ${d.name} (${d.cond}) at ${money(d.price)}. Please keep it on hold for me.\nListing: ${d.url}\nWhen and where can we meet?`;
// seller -> buyer, after Sold
export const msgInformBuyer = (d) => `Hi ${d.buyer}, thank you! Your purchase of ${d.code} ${d.name} (${money(d.price)}) is now marked as sold and complete.\nReceipt no. ${d.no}. I am sending you the PDF receipt in this chat.\nListing: ${d.url}`;

// ---------- PDF ----------
const esc = (s) => String(s ?? '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const wrap = (s, n) => { const out = []; let cur = ''; for (const w of String(s).split(/\s+/)) { if ((cur + ' ' + w).trim().length > n) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; };

export function receiptPdf(d) {
  const ops = [];
  const T = (x, y, size, text, bold, gray) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray} g ${x} ${y} Td (${esc(text)}) Tj ET`);
  const hr = (y) => ops.push(`0.82 G 0.6 w 40 ${y} m 555 ${y} l S`);
  ops.push('0.788 0.145 0.196 rg 0 770 595 72 re f');
  T(40, 808, 22, 'One Piece TCG', true, 1); T(40, 788, 11, 'Sale receipt', false, 1);
  T(360, 808, 9, 'Receipt no.', false, 1); T(360, 793, 13, d.no, true, 1);
  let y = 735;
  const row = (label, value, size = 12, bold = false) => { T(40, y, 8.5, label.toUpperCase(), false, 0.45); T(40, y - 16, size, value, bold, 0); y -= 46; };
  const issued = fmtDate(new Date(), true);
  row('Receipt issued', issued);
  row('Sale marked as sold by the seller', fmtDate(d.soldAt, true) || 'Date not recorded for this sale');
  hr(y + 22);
  T(40, y - 6, 8.5, 'SELLER', false, 0.45); T(300, y - 6, 8.5, 'BUYER', false, 0.45);
  T(40, y - 22, 13, d.seller, true, 0); T(300, y - 22, 13, d.buyer, true, 0); y -= 62; hr(y + 30);
  row('Item', `${d.code}  ${d.name}`, 13, true);
  T(40, y + 8, 8.5, 'RARITY', false, 0.45); T(200, y + 8, 8.5, 'CONDITION', false, 0.45); T(330, y + 8, 8.5, 'LANGUAGE', false, 0.45); T(450, y + 8, 8.5, 'SOLD AS', false, 0.45);
  T(40, y - 8, 12, d.rarity, false, 0); T(200, y - 8, 12, d.cond, false, 0); T(330, y - 8, 12, d.lang, false, 0); T(450, y - 8, 12, d.type === 'auction' ? 'Auction' : 'Buy now', false, 0);
  y -= 46; hr(y + 24);
  T(40, y - 4, 8.5, 'AMOUNT AGREED', false, 0.45); T(40, y - 30, 24, money(d.price), true, 0); y -= 70; hr(y + 30);
  T(40, y, 8.5, 'PAYMENT AND HAND-OVER', false, 0.45);
  wrap('Arranged and completed directly between the buyer and the seller, outside this site.', 95).forEach((ln, i) => T(40, y - 16 - i * 14, 11, ln, false, 0));
  y -= 62;
  T(40, y, 8.5, 'LISTING', false, 0.45); T(40, y - 14, 9, d.url, false, 0.2);
  const fine = ['This receipt was generated from the seller\'s confirmation on the One Piece TCG marketplace.',
    'The site does not take, hold or verify payments, so this receipt is a record of the sale as confirmed by the seller.',
    'Keep it with your own proof of payment. Times are shown in Brunei time (GMT+8).'];
  fine.forEach((ln, i) => T(40, 70 - i * 12, 8, ln, false, 0.4));
  const content = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadReceipt(d) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(receiptPdf(d)); a.download = `Receipt-${d.no}.pdf`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
export function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'application/pdf' })], 'r.pdf', { type: 'application/pdf' })] })); } catch { return false; }
}
export async function shareReceipt(d) {
  const file = new File([receiptPdf(d)], `Receipt-${d.no}.pdf`, { type: 'application/pdf' });
  await navigator.share({ files: [file], title: `Receipt ${d.no}`, text: `Receipt ${d.no}: ${d.code} ${d.name}, ${money(d.price)}` });
}
