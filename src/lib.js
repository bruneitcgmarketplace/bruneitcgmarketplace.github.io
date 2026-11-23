import { createClient } from '@supabase/supabase-js';

export const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const BANK = import.meta.env.VITE_BANK_DETAILS || '';
export const PRICE = import.meta.env.VITE_MEMBER_PRICE || '5';
export const configured = !!(URL_ && KEY);
export const sb = configured ? createClient(URL_, KEY) : null;

export const state = { user: null, me: null, cat: null, inv: null, fx: 0.0085, fxSrc: 'default' };

// ---------- small helpers ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const bnd = (n) => 'BND ' + Number(n).toFixed(2);
export const bndShort = (n) => (n >= 1000 ? 'BND ' + (n / 1000).toFixed(1) + 'k' : bnd(n));
export const isMember = () => !!(state.me?.member_until && new Date(state.me.member_until) > new Date());
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
const setKey = (id) => { const m = id.match(/^([a-z]+)(\d+)$/); const grp = { op: 0, eb: 1, prb: 2, st: 3 }[m?.[1]] ?? 4; return grp * 1000 - (m ? +m[2] : 0) * (grp === 3 ? -1 : 1); };

export async function loadCatalog() {
  if (state.cat) return state.cat;
  const raw = await (await fetch(import.meta.env.BASE_URL + 'catalog.json')).json();
  const cards = [], byRef = new Map(), byCode = new Map(), bySet = new Map();
  for (const r of raw.cards) {
    const [num, set, code, jp, rarity, jpy, en, color, type] = r;
    const c = { ref: set + '-' + num, num, set, code, jp, en, name: en || jp, rarity, jpy, color, type,
      parallel: /^(P-|SP)/.test(rarity) || /パラレル/.test(jp), home: code.toLowerCase().startsWith(set), def: false };
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
export const catImg = (c, size = '200_280') => `https://card.yuyu-tei.jp/opc/${size}/${c.set}/${c.num}.jpg`;
export const cardImg = (c, cls = '') => `<img class="${cls}" loading="lazy" src="${esc(catImg(c))}" alt="${esc(c.code)}" onerror="this.style.visibility='hidden'">`;
export const refBnd = (c) => (c && c.jpy ? c.jpy * state.fx : 0);
export const setName = (id) => state.cat?.setNames[id] || id.toUpperCase();
export const colorDot = (col) => {
  const m = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7', black: '#64748b', yellow: '#facc15' };
  const first = (col || '').toLowerCase().split(/[\/ ]/)[0];
  return `<span class="dot" style="background:${m[first] || '#475569'}" title="${esc(col)}"></span>`;
};

export async function loadFx() {
  const manual = parseFloat(localStorage.getItem('fx_manual') || '');
  if (manual > 0) { state.fx = manual; state.fxSrc = 'manual'; return; }
  try {
    const cached = JSON.parse(localStorage.getItem('fx') || 'null');
    if (cached && Date.now() - cached.t < 12 * 3600e3) { state.fx = cached.rate; state.fxSrc = 'frankfurter ' + cached.d; return; }
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=JPY&symbols=SGD');
    const j = await r.json();
    if (j?.rates?.SGD) { state.fx = j.rates.SGD; state.fxSrc = 'frankfurter ' + j.date; localStorage.setItem('fx', JSON.stringify({ rate: j.rates.SGD, d: j.date, t: Date.now() })); }
  } catch { const c = JSON.parse(localStorage.getItem('fx') || 'null'); if (c) { state.fx = c.rate; state.fxSrc = 'frankfurter ' + c.d + ' (cached)'; } }
}

// ---------- auth + profile ----------
export async function loadMe() {
  state.me = null; state.inv = null;
  if (!state.user) return;
  const { data } = await sb.from('private_profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.me = data;
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
  const { data, error } = await sb.from('inventory').select('card_ref, qty').limit(5000);
  if (error) throw error;
  state.inv = new Map((data || []).map((r) => [r.card_ref, r.qty]));
  return state.inv;
}
export async function invAdjust(ref, delta) {
  const q = await rpc('inventory_adjust', { p_card_ref: ref, p_delta: delta });
  await loadInv();
  if (q > 0) state.inv.set(ref, q); else state.inv.delete(ref);
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
    rows.push({ c, q, v });
  }
  return { value, count, unique: rows.length, bySet, owned, rows };
}

// ---------- listings ----------
export const listingPrice = (l) => (l.type === 'auction' ? Number(l.current_bid ?? l.start_price) : Number(l.price));
export const listingImg = (l) => l.photos?.[0] || l.catalog_image || '';
export function tile(l) {
  const ref = state.cat?.byRef.get(l.card_ref);
  const r = ref ? refBnd(ref) : 0, p = listingPrice(l);
  const deal = l.type === 'buy_now' && r > 0 && p <= r * 0.9 ? `<span class="badge warn">Below market</span>` : '';
  return `<a class="tile" href="#/listing/${l.id}">
    <img loading="lazy" src="${esc(listingImg(l))}" alt="" onerror="this.style.visibility='hidden'">
    <div class="b"><div class="code">${esc(l.card_code)} · ${esc(l.rarity || '')} · ${esc(l.condition)}</div>
    <div class="nm">${esc(ref?.name || l.card_name)}</div>
    <div class="row tight between"><span class="price">${bnd(p)}</span><span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span></div>
    ${l.type === 'auction' ? `<div class="muted">${l.bid_count} bids · ${timerHtml(l.ends_at)}</div>` : deal}</div></a>`;
}

// ---------- card picker (search the catalogue) ----------
export async function cardPicker(onPick, { title = 'Find a card' } = {}) {
  const cat = await loadCatalog();
  const s = sheet(`<h2>${esc(title)}</h2><input id="cp-q" placeholder="Code or name, e.g. OP05-060 or Luffy" autocomplete="off"><label class="inline"><input type="checkbox" id="cp-alt" style="width:auto"> Include alternate arts</label><div id="cp-res" class="pick-list"></div>`);
  const q = s.el.querySelector('#cp-q'), res = s.el.querySelector('#cp-res'), alt = s.el.querySelector('#cp-alt');
  const run = () => {
    const t = q.value.trim().toLowerCase();
    if (t.length < 2) { res.innerHTML = '<p class="muted">Type at least 2 characters.</p>'; return; }
    const hits = cat.cards.filter((c) => (alt.checked || c.def) && (c.code.toLowerCase().includes(t) || c.en.toLowerCase().includes(t) || c.jp.includes(t))).slice(0, 40);
    res.innerHTML = hits.map((c, i) => `<div class="pick" data-i="${i}">${cardImg(c)}<div><b>${esc(c.code)}</b> ${colorDot(c.color)} ${esc(c.rarity)}<br><span class="muted">${esc(c.name)}${c.parallel ? ' · alt art' : ''}</span></div><span class="muted">${c.jpy ? bnd(refBnd(c)) : ''}</span></div>`).join('') || '<p class="muted">No match.</p>';
    res.querySelectorAll('.pick').forEach((p) => (p.onclick = () => { const c = hits[+p.dataset.i]; s.close(); onPick(c); }));
  };
  q.oninput = run; alt.onchange = run; run(); q.focus();
}

export function enlarge(c) {
  const s = sheet(`<img class="big" src="${esc(catImg(c, '200_280'))}" alt=""><p><b>${esc(c.code)}</b> ${esc(c.rarity)}<br>${esc(c.name)}</p><p class="muted">${esc(setName(c.set))}</p>`);
  const big = new Image(); big.onload = () => { const im = s.el.querySelector('img.big'); if (im) im.src = big.src; };
  big.src = `https://card.yuyu-tei.jp/opc/front/${c.set}/${c.num}.jpg`;
}
