import { createClient } from '@supabase/supabase-js';

export const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const BANK = import.meta.env.VITE_BANK_DETAILS || '';
export const PRICE = import.meta.env.VITE_MEMBER_PRICE || '5';
export const configured = !!(URL_ && KEY);
export const sb = configured ? createClient(URL_, KEY) : null;

export const state = { user: null, me: null, avatar: null, cat: null, inv: null, fx: 0.0085, fxSrc: 'default', umeta: new Map() };

// ---------- small helpers ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const bnd = (n) => 'BND ' + Number(n).toFixed(2);
export const bndShort = (n) => (n >= 1000 ? 'BND ' + (n / 1000).toFixed(1) + 'k' : bnd(n));
// Membership plan is paused for the testing period: every signed-in user gets all features.
// Set to true to bring the plan back (and re-apply the is_member() function from supabase/01_schema.sql).
export const MEMBERSHIP_ENABLED = false;
export const isMember = () => !MEMBERSHIP_ENABLED || !!(state.me?.member_until && new Date(state.me.member_until) > new Date());
export const $ = (sel, root = document) => root.querySelector(sel);

let toastT;
export function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'on' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), 3500);
}
export async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
export const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || String(e), true); } };

export function fmtLeft(ms) {
  if (ms <= 0) return 'Ended';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${s % 60}s` : `${m}m ${s % 60}s`;
}
export const timerHtml = (iso, reload = false) => `<span class="timer" data-end="${esc(iso)}" ${reload ? 'data-reload="1"' : ''}></span>`;

// ---------- modal sheet ----------
export function sheet(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet"><button class="sheet-x" aria-label="Close">✕</button>${html}</div>`;
  const close = () => { wrap.remove(); document.body.classList.remove('noscroll'); onClose?.(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.sheet-x').onclick = close;
  document.body.appendChild(wrap); document.body.classList.add('noscroll');
  return { el: wrap.querySelector('.sheet'), close };
}
export function confirmSheet(title, body, okLabel = 'Confirm', danger = false) {
  return new Promise((res) => {
    const s = sheet(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row tight"><button class="btn ${danger ? 'bad' : ''}" id="cs-ok">${esc(okLabel)}</button><button class="btn sec" id="cs-no">Cancel</button></div>`, { onClose: () => res(false) });
    s.el.querySelector('#cs-ok').onclick = () => { res(true); s.close(); };
    s.el.querySelector('#cs-no').onclick = () => s.close();
  });
}
export function promptSheet(title, label, { value = '', okLabel = 'OK', multiline = false } = {}) {
  return new Promise((res) => {
    const s = sheet(`<h2>${esc(title)}</h2><label>${esc(label)}</label>${multiline ? `<textarea id="ps-in" rows="3">${esc(value)}</textarea>` : `<input id="ps-in" value="${esc(value)}">`}<p><button class="btn" id="ps-ok">${esc(okLabel)}</button></p>`, { onClose: () => res(null) });
    s.el.querySelector('#ps-ok').onclick = () => { res(s.el.querySelector('#ps-in').value); s.close(); };
  });
}

// ---------- catalog ----------
// Art type from the Yuyutei card name and rarity. Yuyutei writes the Japanese 'Manga Rare' as (スーパーパラレル) = super parallel.
export const ART = {
  std: ['Standard art', 'Standard'], don: ['DON!! card', 'DON!!'], alt: ['Alternate art', 'Alt art'], manga: ['Manga (Super Parallel)', 'Manga'], redmanga: ['Red Manga (Red Super Parallel)', 'Red Manga'],
  goldsilver: ['Gold / Silver SP', 'SP Gold/Silver'], special: ['Special / drawn art', 'Special art'], foil: ['Foil variant', 'Foil'],
  sp: ['SP (Special)', 'SP'], tr: ['Treasure Rare', 'Treasure'], promo: ['Promo', 'Promo'],
};
export function artOf(jp, rarity) {
  if (rarity === '-' || /^ドン!!カード/.test(jp)) return 'don';   // DON!! cards (every art, incl. manga) have their own category
  if (/レッドスーパーパラレル/.test(jp)) return 'redmanga';
  if (/スーパーパラレル/.test(jp)) return 'manga';
  if (/金パラレル|銀パラレル/.test(jp)) return 'goldsilver';
  if (/特別パラレル|描き下ろしパラレル/.test(jp)) return 'special';
  if (/ラメフォイル|海賊旗フォイル|箔押し/.test(jp)) return 'foil';
  if (rarity === 'TR') return 'tr';
  if (rarity === 'SP') return 'sp';
  if (/^P-/.test(rarity) || /パラレル/.test(jp)) return 'alt';
  if (rarity === 'P') return 'promo';
  return 'std';
}
export const artShort = (c) => (c.art && c.art !== 'std' ? ART[c.art][1] : '');
const setKey = (id) => { const m = id.match(/^([a-z]+)(\d+)$/); const grp = { op: 0, eb: 1, prb: 2, st: 3 }[m?.[1]] ?? 4; return grp * 1000 - (m ? +m[2] : 0) * (grp === 3 ? -1 : 1); };

export async function loadCatalog(force = false) {
  if (state.cat && !force) return state.cat;
  const raw = await (await fetch(import.meta.env.BASE_URL + 'catalog.json' + (force ? '?v=' + Date.now() : ''), force ? { cache: 'no-store' } : undefined)).json();
  const cards = [], byRef = new Map(), byCode = new Map(), bySet = new Map();
  for (const r of raw.cards) {
    const [num, set, code, jp, rarity, jpy, en, color, type] = r;
    const c = { ref: set + '-' + num, num, set, code, jp, en, name: en || jp, rarity, jpy, color, type,
      parallel: /^(P-|SP)/.test(rarity) || /パラレル/.test(jp), art: artOf(jp, rarity), home: code.toLowerCase().startsWith(set), def: false };
    cards.push(c); byRef.set(c.ref, c);
    (byCode.get(code) || byCode.set(code, []).get(code)).push(c);
    (bySet.get(set) || bySet.set(set, []).get(set)).push(c);
  }
  const order = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : (a.parallel - b.parallel) || (a.num - b.num));
  cards.sort(order);
  for (const list of bySet.values()) list.sort(order);
  for (const list of byCode.values()) list.sort(order);
  for (const list of byCode.values()) {
    const d = list.find((c) => !c.parallel && c.home) || list.find((c) => !c.parallel) || list[0];
    d.def = true;
  }
  const sets = [...bySet.keys()].sort((a, b) => setKey(a) - setKey(b)).map((id) => ({
    id, name: raw.sets[id] || id.toUpperCase(), count: new Set(bySet.get(id).map((c) => c.code)).size, cards: bySet.get(id) }));
  state.cat = { updated: raw.updated, cards, byRef, byCode, bySet, sets, setNames: raw.sets, rawRefs: raw.cards.map((r) => r[1] + '-' + r[0]) };
  return state.cat;
}
// Yuyutei only serves these sizes: 100_140, 200_280, 250_350 and 'front' (500x700). Anything else is a 404.
export const IMG_BASE = 'https://card.yuyu-tei.jp/opc/';
export const catImg = (c, size = '250_350') => `${IMG_BASE}${size}/${c.set}/${c.num}.jpg`;
// Re-point a catalogue image URL (e.g. one stored in an older listing) at another size; other URLs (seller photos) are untouched.
export const upImg = (url, size = '250_350') => (url || '').replace(/(card\.yuyu-tei\.jp\/opc\/)(?:\d+_\d+|front)(\/)/, `$1${size}$2`);
const isCat = (url) => /card\.yuyu-tei\.jp\/opc\//.test(url || '');
// Source page of a catalogue card on Yuyutei (the picture URL .../opc/<size>/<set>/<number>.jpg maps to /sell/opc/card/<set>/<number>)
export const yuyuCard = (set, num) => `https://yuyu-tei.jp/sell/opc/card/${set}/${num}`;
export const yuyuFromImg = (url) => { const m = /card\.yuyu-tei\.jp\/opc\/(?:\d+_\d+|front)\/([a-z0-9-]+)\/([A-Za-z0-9-]+)\.jpg/.exec(url || ''); return m ? yuyuCard(m[1], m[2]) : null; };
// Show a small image straight away, then swap in the sharp one when it has loaded.
export function sharpen(img, hiUrl) {
  if (!img || !hiUrl) return;
  const big = new Image();
  big.onload = () => { if (img.isConnected) img.src = hiUrl; };
  big.src = hiUrl;
}
export const cardImg = (c, cls = '') => `<img class="${cls}" loading="lazy" decoding="async" src="${esc(catImg(c, cls === 'xs' ? '100_140' : cls === 'sm' ? '200_280' : '250_350'))}" ${cls === '' ? `data-hd="${esc(catImg(c, 'front'))}"` : ''} alt="${esc(c.code)}" onerror="this.style.visibility='hidden'">`;

// ----- sharper images on screen: swap tiles to the 500x700 image once they scroll into view -----
export const hdOn = () => localStorage.getItem('hd_images') !== '0';
let hdObs = null;
export function initHd() {
  if (hdObs || !('IntersectionObserver' in window)) return;
  hdObs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target; hdObs.unobserve(img);
      if (hdOn() && img.dataset.hd) sharpen(img, img.dataset.hd);
    }
  }, { rootMargin: '120px' });
  const scan = (root) => root.querySelectorAll?.('img[data-hd]').forEach((i) => { if (!i.dataset.hdSeen) { i.dataset.hdSeen = '1'; hdObs.observe(i); } });
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) { if (n.nodeType === 1) { if (n.matches?.('img[data-hd]')) { n.dataset.hdSeen = '1'; hdObs.observe(n); } else scan(n); } } })
    .observe(document.getElementById('app'), { childList: true, subtree: true });
}
export const refBnd = (c) => (c && c.jpy ? c.jpy * state.fx : 0);
export const setName = (id) => state.cat?.setNames[id] || id.toUpperCase();
export const colorDot = (col) => {
  const m = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7', black: '#64748b', yellow: '#facc15' };
  const first = (col || '').toLowerCase().split(/[\/ ]/)[0];
  return `<span class="dot" style="background:${m[first] || '#475569'}" title="${esc(col)}"></span>`;
};

export async function loadFx(force = false) {
  const manual = parseFloat(localStorage.getItem('fx_manual') || '');
  if (manual > 0) { state.fx = manual; state.fxSrc = 'manual'; return; }
  try {
    const cached = JSON.parse(localStorage.getItem('fx') || 'null');
    if (!force && cached && Date.now() - cached.t < 12 * 3600e3) { state.fx = cached.rate; state.fxSrc = 'frankfurter ' + cached.d; return; }
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=JPY&symbols=SGD', force ? { cache: 'no-store' } : undefined);
    const j = await r.json();
    if (j?.rates?.SGD) { state.fx = j.rates.SGD; state.fxSrc = 'frankfurter ' + j.date; localStorage.setItem('fx', JSON.stringify({ rate: j.rates.SGD, d: j.date, t: Date.now() })); }
  } catch { const c = JSON.parse(localStorage.getItem('fx') || 'null'); if (c) { state.fx = c.rate; state.fxSrc = 'frankfurter ' + c.d + ' (cached)'; } }
}

// ---------- auth + profile ----------
export async function loadMe() {
  state.me = null; state.inv = null; state.avatar = null;
  if (!state.user) return;
  const { data } = await sb.from('private_profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.me = data;
  const { data: pr } = await sb.from('profiles').select('avatar_url').eq('id', state.user.id).maybeSingle();   // my chosen picture (falls back to the Google photo)
  state.avatar = pr?.avatar_url || null;
}
export const signIn = guard(async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
});
export const signOut = guard(async () => { await sb.auth.signOut(); location.hash = '#/'; });
export const needLogin = (why = 'continue') => `<div class="panel center"><p>Sign in to ${esc(why)}.</p><button class="btn" id="login-btn">Sign in with Google</button></div>`;
export function bindLogin(root = document) { const b = root.querySelector('#login-btn'); if (b) b.onclick = signIn; }

// ---------- inventory ----------
export async function loadInv(force = false) {
  if (!state.user) return new Map();
  if (state.inv && !force) return state.inv;
  const { data, error } = await sb.from('inventory').select('card_ref, qty, updated_at').limit(5000);
  if (error) throw error;
  state.inv = new Map((data || []).map((r) => [r.card_ref, r.qty]));
  state.invAt = new Map((data || []).map((r) => [r.card_ref, Date.parse(r.updated_at) || 0]));   // when each card was last added or changed
  return state.inv;
}
export async function invAdjust(ref, delta) {
  const q = await rpc('inventory_adjust', { p_card_ref: ref, p_delta: delta });
  await loadInv();
  if (q > 0) { state.inv.set(ref, q); (state.invAt ||= new Map()).set(ref, Date.now()); } else state.inv.delete(ref);
  return q;
}
export function invStats() {
  const cat = state.cat, inv = state.inv || new Map();
  let value = 0, count = 0; const bySet = new Map(), owned = new Map(), rows = [];
  for (const [ref, q] of inv) {
    const c = cat.byRef.get(ref); if (!c) continue;
    const v = refBnd(c) * q; value += v; count += q;
    bySet.set(c.set, (bySet.get(c.set) || 0) + v);
    (owned.get(c.set) || owned.set(c.set, new Set()).get(c.set)).add(c.code);
    rows.push({ c, q, v, t: state.invAt?.get(ref) || 0 });
  }
  return { value, count, unique: rows.length, bySet, owned, rows };
}

// ---------- listings ----------
export const listingPrice = (l) => (l.type === 'auction' ? Number(l.current_bid ?? l.start_price) : Number(l.price));
export const listingImg = (l) => l.photos?.[0] || upImg(l.catalog_image, '250_350') || '';
// seller name, tag icons and star rating under a listing tile (needs primeMeta() to have run for these sellers)
const TAG_ICON = { verified: '✔', moderator: '🛡', trusted: '🏅', vip: '💎' };
function sellerLine(l) {
  const m = state.umeta.get(l.seller_id); if (!m) return '';
  const icons = Object.keys(TAG_ICON).filter((k) => m.tags.includes(k)).map((k) => `<span title="${esc(TAGS[k])}">${TAG_ICON[k]}</span>`).join('');
  return `<div class="sline"><span class="sn">${esc(l.seller?.display_name || 'Seller')}</span>${icons ? ` <span class="si">${icons}</span>` : ''} ${m.n ? `<span class="stars">★ ${m.avg.toFixed(1)}</span><span class="muted">(${m.n})</span>` : '<span class="muted">New</span>'}</div>`;
}
export async function primeMeta(rows) {
  const ids = [...new Set((rows || []).map((l) => l.seller_id).filter((i) => i && !state.umeta.has(i)))];
  if (!ids.length) return;
  try { for (const [k, v] of await userMeta(ids)) state.umeta.set(k, v); } catch { /* tiles just show without ratings */ }
}
// Identical Buy now offers (same seller, card, condition, language, price) become one tile with a quantity.
// Held (reserved) copies only show on their own when nothing in that group is still free.
// Manual items (sealed packs, boxes, cases, slabs, promo cards): not in the catalogue, so card_ref is empty.
export const KINDS = { card: 'Single card', promo: 'Promo / other card', pack: 'Sealed pack', box: 'Booster box', case: 'Case', slab: 'Graded slab', other: 'Other' };
export const SEALED_KINDS = new Set(['pack', 'box', 'case', 'slab', 'other']);   // no card condition
export const condSfx = (l) => (SEALED_KINDS.has(l.kind) || !l.condition ? '' : ` · ${l.condition}`);
export const itemKey = (l) => (l.card_ref ? l.card_ref : ['~', l.kind, l.card_name, l.rarity, l.card_code].join('~'));
export function groupBuyNow(rows) {
  const key = (l) => [l.seller_id, itemKey(l), l.condition, l.language, l.price].join('|');
  const free = new Set(rows.filter((l) => l.type === 'buy_now' && l.status === 'active').map(key));
  const seen = new Map(), out = [];
  for (const l of rows) {
    if (l.type !== 'buy_now') { out.push(l); continue; }
    if (l.status !== 'active') { if (!free.has(key(l))) out.push(l); continue; }
    const g = seen.get(key(l));
    if (g) { g._n++; g._ids.push(l.id); } else { const rep = { ...l, _n: 1, _ids: [l.id] }; seen.set(key(l), rep); out.push(rep); }
  }
  return out;
}
// compact row for the List view
export function listRow(l) {
  const ref = state.cat?.byRef.get(l.card_ref), p = listingPrice(l), held = l.type === 'buy_now' && l.status === 'reserved', m = state.umeta.get(l.seller_id);
  return `<a class="lrow${held ? ' held' : ''}" href="#/listing/${l.id}">
    <img loading="lazy" decoding="async" src="${esc(listingImg(l))}" alt="" onerror="this.style.visibility='hidden'">
    <div class="lb"><div class="lt"><b>${esc(l.card_code)}</b> ${esc(l.rarity || '')}${esc(condSfx(l))}${l._n > 1 ? ` <span class="qtag s">×${l._n}</span>` : ''}${held ? ' <span class="badge">On hold</span>' : ''}</div>
      <div class="ln">${esc(ref?.name || l.card_name)}</div>
      <div class="lm">${esc(l.seller?.display_name || '')}${m && m.n ? ` · <span class="stars">★ ${m.avg.toFixed(1)}</span>` : ''}${l.type === 'auction' ? ` · ${l.bid_count} bids · ${timerHtml(l.ends_at)}` : l._n > 1 ? ` · <span class="avail">${l._n} available</span>` : ''}</div></div>
    <div class="lp"><span class="price">${bnd(p)}</span><span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span></div></a>`;
}
export function tile(l) {
  const ref = state.cat?.byRef.get(l.card_ref);
  const r = ref ? refBnd(ref) : 0, p = listingPrice(l);
  const deal = l.type === 'buy_now' && r > 0 && p <= r * 0.9 ? `<span class="badge warn">Below market</span>` : '';
  const held = l.type === 'buy_now' && l.status === 'reserved';
  return `<a class="tile${held ? ' held' : ''}" href="#/listing/${l.id}">
    <img loading="lazy" decoding="async" src="${esc(listingImg(l))}" ${!l.photos?.length ? `data-hd="${esc(upImg(l.catalog_image, 'front'))}"` : ''} alt="${esc(l.card_code)}" onerror="this.style.visibility='hidden'">
    ${held ? '<span class="holdtag">On hold</span>' : ''}${l._n > 1 ? `<span class="qtag">×${l._n}</span>` : ''}
    <div class="b"><div class="code">${esc([l.card_code, l.rarity].filter(Boolean).join(' · ') + condSfx(l))}</div>
    <div class="nm">${esc(ref?.name || l.card_name)}</div>
    <div class="row tight between"><span class="price">${bnd(p)}</span><span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span></div>
    ${l._n > 1 ? `<div class="avail">${l._n} available</div>` : ''}
    ${sellerLine(l)}
    ${l.type === 'auction' ? `<div class="muted">${l.bid_count} bids · ${timerHtml(l.ends_at)}</div>` : held ? `<div class="holdnote"><b>On hold.</b> Another buyer is completing this purchase.</div>` : deal}</div></a>`;
}

// ---------- card picker (search the catalogue) ----------
export async function cardPicker(onPick, { title = 'Find a card' } = {}) {
  const cat = await loadCatalog();
  const s = sheet(`<h2>${esc(title)}</h2><input id="cp-q" placeholder="Code or name, e.g. OP05-060 or Luffy" autocomplete="off"><div id="cp-res" class="pick-list"></div>`);
  const q = s.el.querySelector('#cp-q'), res = s.el.querySelector('#cp-res');
  const run = () => {
    const t = q.value.trim().toLowerCase();
    if (t.length < 2) { res.innerHTML = '<p class="muted">Type at least 2 characters.</p>'; return; }
    const hits = cat.cards.filter((c) => (c.code.toLowerCase().includes(t) || c.en.toLowerCase().includes(t) || c.jp.includes(t))).slice(0, 60);
    res.innerHTML = hits.map((c, i) => `<div class="pick" data-i="${i}">${cardImg(c)}<div><b>${esc(c.code)}</b> ${colorDot(c.color)} ${esc(c.rarity)}<br><span class="muted">${esc(c.name)}${artShort(c) ? ' · ' + esc(artShort(c)) : ''}</span></div><span class="muted">${c.jpy ? bnd(refBnd(c)) : ''}</span></div>`).join('') || '<p class="muted">No match.</p>';
    res.querySelectorAll('.pick').forEach((p) => (p.onclick = () => { const c = hits[+p.dataset.i]; s.close(); onPick(c); }));
  };
  q.oninput = run; run(); q.focus();
}

export function enlarge(c) {
  import('./lightbox.js').then((m) => m.openLightbox([catImg(c, 'front')], 0, [`${c.code} ${c.name}`]));
}

// Avatar: coloured initial underneath, Google photo on top. If the photo is blocked or missing, the initial shows.
export function avatarHtml(size = 'md') {
  const u = state.user; if (!u) return '';
  const name = u.user_metadata?.full_name || state.me?.display_name || u.email || '?';
  const pic = state.avatar || u.user_metadata?.avatar_url || u.user_metadata?.picture;
  return `<span class="av ${size}">${esc(String(name).trim()[0]?.toUpperCase() || '?')}${pic ? `<img src="${esc(pic)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;
}

// ---------- ratings and tags ----------
export const TAGS = { verified: '✔ Verified', moderator: '🛡 Moderator', trusted: '★ Trusted seller', vip: '💎 VIP' };
// ratings summary + tags for a list of user ids -> Map(id -> { avg, n, tags })
export async function userMeta(ids) {
  const out = new Map(); const u = [...new Set(ids.filter(Boolean))]; if (!u.length) return out;
  for (const id of u) out.set(id, { avg: 0, n: 0, tags: [] });
  const [r, t] = await Promise.all([sb.from('rating_summary').select('ratee_id, avg, n').in('ratee_id', u), sb.from('user_tags').select('user_id, tag').in('user_id', u)]);
  for (const x of r.data || []) { const m = out.get(x.ratee_id); if (m) { m.avg = Number(x.avg); m.n = x.n; } }
  for (const x of t.data || []) out.get(x.user_id)?.tags.push(x.tag);
  return out;
}
export const starsHtml = (avg, n) => (n ? `<span class="stars" title="${avg.toFixed(1)} out of 5">★ ${avg.toFixed(1)}</span> <span class="muted">(${n})</span>` : '<span class="muted">No ratings yet</span>');
export const tagsHtml = (tags = []) => Object.keys(TAGS).filter((k) => tags.includes(k)).map((k) => `<span class="utag t-${k}">${esc(TAGS[k])}</span>`).join(' ');
// 1-5 star pop-up with an optional comment. Resolves true after the rating is saved.
export function rateSheet(listingId, whom) {
  const ids = [].concat(listingId);   // one rating can cover several deals with the same person
  return new Promise((res) => {
    let stars = 0;
    const s = sheet(`<h2>Rate the ${esc(whom)}${ids.length > 1 ? ` (${ids.length} deals)` : ''}</h2><p class="muted">How did the deal go? Your rating is public and cannot be changed later.</p>
      <div class="starpick" id="rs-stars">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-s="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <label>Comment (optional)</label><textarea id="rs-c" rows="3" maxlength="300" placeholder="Fast reply, card as described…"></textarea>
      <div class="row tight" style="margin-top:.6rem"><button class="btn" id="rs-ok" disabled>Submit rating</button><button class="btn sec" id="rs-no">Cancel</button></div>`, { onClose: () => res(false) });
    const q = (x) => s.el.querySelector(x);
    q('#rs-stars').querySelectorAll('button').forEach((b) => (b.onclick = () => { stars = Number(b.dataset.s); q('#rs-stars').querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.s) <= stars)); q('#rs-ok').disabled = false; }));
    q('#rs-no').onclick = () => s.close();
    q('#rs-ok').onclick = async () => {
      q('#rs-ok').disabled = true;
      let done = 0; const batch = crypto.randomUUID();   // all deals in this pop-up are ONE review
      try { for (const id of ids) { await rpc('rate_user', { p_listing: id, p_stars: stars, p_comment: q('#rs-c').value, p_batch: batch }); done++; } toast('Thanks, rating saved'); res(true); s.close(); }
      catch (e) { if (done) { toast(`${done} of ${ids.length} rated, then: ${e.message || e}`, true); res(true); s.close(); return; } q('#rs-ok').disabled = false; toast(e.message || String(e), true); }
    };
  });
}

// The database returns at most 1000 rows per request. Read every page of a query (make = () => a fresh query builder).
export async function fetchAll(make, max = 20000) {
  const out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return out;
}
