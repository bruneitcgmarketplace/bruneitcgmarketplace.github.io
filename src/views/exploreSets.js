// Explore: One Piece sets with actual product photos and a full filter panel.
import { sb, state, esc, bnd, loadCatalog, loadInv, refBnd, cardImg, sheet, ART, artShort } from '../lib.js';

// ---------- set icon (booster box) ----------
const GROUPS = [
  ['op', 'Booster boxes', 'OP', ['#e0343c', '#7d1520']],
  ['eb', 'Extra boosters', 'EB', ['#f5b82e', '#9a5a05']],
  ['prb', 'Premium boosters', 'PRB', ['#a24ee0', '#4a1a78']],
  ['st', 'Starter decks', 'ST', ['#2c8fe0', '#0f3d78']],
];
export const groupOf = (id) => (/^(op|eb|prb|st)/.exec(id) || [])[1] || 'op';
const numOf = (id) => parseInt(id.replace(/\D/g, ''), 10) || 0;
export const setLabel = (s) => `${s.id.toUpperCase()} - ${s.name.replace(/^(Starter Deck|Extra Booster|Premium Booster)\s*\d*:?\s*/i, '')}`;

// Local product photos: predictable paths work on first Home load and offline.
// All assets share a 400px white canvas; sources are recorded in public/sets/sources.json.
export function setIcon(s) {
  const code = s.id.toUpperCase(), type = groupOf(s.id) === 'st' ? 'starter deck' : 'booster box';
  return `<span class="sbox"><img class="spic" src="${import.meta.env.BASE_URL}sets/${esc(s.id)}.webp" alt="${esc(code)} ${type}" width="400" height="400" loading="lazy" decoding="async" onerror="this.hidden=true;this.parentElement.classList.add('missing')"><span class="set-photo-fallback">${esc(code)}<small>Photo unavailable</small></span></span>`;
}
export const setCard = (s, pct) => `<a class="setc" href="#/set/${s.id}">${setIcon(s)}<div class="sn"><b>${esc(s.id.toUpperCase())}</b><span class="set-name">${esc(s.name.replace(/^(Starter Deck|Extra Booster|Premium Booster)\s*\d*:?\s*/i, ''))}</span></div>${pct != null ? `<div class="obar"><i style="width:${Math.round(pct)}%"></i></div>` : ''}</a>`;

// ---------- card details for the stat filters (cost, power, ...) ----------
let info = null;
export async function loadInfo() {
  if (info) return info;
  info = await (await fetch(import.meta.env.BASE_URL + 'cardinfo.json')).json();
  return info;
}
const KEYWORDS = ['Rush', 'Blocker', 'Double Attack', 'Banish', 'Trigger', 'On Play', 'When Attacking', 'On K.O.', 'Activate: Main', 'Counter', "Opponent's Turn", 'Your Turn', 'Once Per Turn', 'DON!! x1', 'DON!! x2'];
const RARITIES = [['L', 'Leader'], ['SEC', 'Secret Rare'], ['SR', 'Super Rare'], ['R', 'Rare'], ['UC', 'Uncommon'], ['C', 'Common'], ['SP', 'Special'], ['TR', 'Treasure Rare'], ['P', 'Promo'], ['P-L', 'Alt art L'], ['P-SEC', 'Alt art SEC'], ['P-SR', 'Alt art SR'], ['P-R', 'Alt art R'], ['P-UC', 'Alt art UC'], ['P-C', 'Alt art C'], ['P-P', 'Alt art promo'], ['-', 'DON!!']];
const COLOURS = [['Red', '#e0343c'], ['Green', '#2fc76d'], ['Blue', '#2c8fe0'], ['Purple', '#a24ee0'], ['Black', '#777'], ['Yellow', '#ffc83d']];
const TYPES = ['Leader', 'Character', 'Event', 'Stage', 'DON!!'];
const ATTRS = ['Slash', 'Strike', 'Ranged', 'Special', 'Wisdom'];
const SORTS = [['new', 'Newest set first'], ['plow', 'Price: low to high'], ['phigh', 'Price: high to low'], ['name', 'Name A to Z'], ['code', 'Card number']];
const FRESH = () => ({ q: '', groups: [], sets: [], rar: [], col: [], colAll: false, type: [], arts: [], pmin: '', pmax: '', cmin: '', cmax: '', wmin: '', wmax: '', counter: [], life: [], attr: [], trait: '', kw: [], own: 'all', sale: false, sort: 'new' });
const NEEDS_INFO = (f) => f.cmin !== '' || f.cmax !== '' || f.wmin !== '' || f.wmax !== '' || f.counter.length || f.life.length || f.attr.length || f.trait || f.kw.length;
const num = (v) => (v === '' || v == null ? null : Number(v));

function activeCount(f) {
  return (f.groups.length ? 1 : 0) + (f.sets.length ? 1 : 0) + (f.rar.length ? 1 : 0) + (f.col.length ? 1 : 0) + (f.type.length ? 1 : 0) + (f.arts.length ? 1 : 0)
    + ((f.pmin !== '' || f.pmax !== '') ? 1 : 0) + ((f.cmin !== '' || f.cmax !== '') ? 1 : 0) + ((f.wmin !== '' || f.wmax !== '') ? 1 : 0) + (f.counter.length ? 1 : 0) + (f.life.length ? 1 : 0)
    + (f.attr.length ? 1 : 0) + (f.trait ? 1 : 0) + (f.kw.length ? 1 : 0) + (f.own !== 'all' ? 1 : 0) + (f.sale ? 1 : 0);
}

function apply(f, cards, inv, saleCodes, det) {
  const q = f.q.trim().toLowerCase();
  const pmin = num(f.pmin), pmax = num(f.pmax), cmin = num(f.cmin), cmax = num(f.cmax), wmin = num(f.wmin), wmax = num(f.wmax), tr = f.trait.trim().toLowerCase();
  const kwRe = f.kw.map((k) => new RegExp('\\[' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]', 'i'));
  let noInfo = 0;
  const list = cards.filter((c) => {
    if (q && !(c.code + ' ' + c.name + ' ' + c.jp).toLowerCase().includes(q)) return false;
    if (f.groups.length && !f.groups.includes(groupOf(c.set))) return false;
    if (f.sets.length && !f.sets.includes(c.set)) return false;
    if (f.rar.length && !f.rar.includes(c.rarity)) return false;
    if (f.type.length && !(f.type.includes(c.type) || (f.type.includes('DON!!') && c.rarity === '-'))) return false;
    if (f.col.length) { const cc = (c.color || '').split(' ').filter(Boolean); if (f.colAll ? !f.col.every((x) => cc.includes(x)) : !f.col.some((x) => cc.includes(x))) return false; }
    if (f.arts.length && !f.arts.includes(c.art)) return false;
    if (pmin != null || pmax != null) { const p = c.jpy ? refBnd(c) : null; if (p == null || (pmin != null && p < pmin) || (pmax != null && p > pmax)) return false; }
    if (f.own !== 'all' && (f.own === 'owned') !== inv.has(c.ref)) return false;
    if (f.sale && !saleCodes.has(c.code)) return false;
    if (det) {
      const d = det[c.code];
      if (!d) { noInfo++; return false; }
      const [cost, pow, ctr, life, attr, traits, text] = d;
      if ((cmin != null || cmax != null) && (cost == null || (cmin != null && cost < cmin) || (cmax != null && cost > cmax))) return false;
      if ((wmin != null || wmax != null) && (pow == null || (wmin != null && pow < wmin) || (wmax != null && pow > wmax))) return false;
      if (f.counter.length && !f.counter.includes(String(ctr ?? 0))) return false;
      if (f.life.length && !f.life.includes(String(life))) return false;
      if (f.attr.length && !f.attr.some((a) => (attr || '').includes(a))) return false;
      if (tr && !(traits || '').toLowerCase().includes(tr)) return false;
      if (kwRe.length && !kwRe.every((r) => r.test(text || ''))) return false;
    }
    return true;
  });
  const key = { new: (a, b) => setKeyOf(b.set) - setKeyOf(a.set) || (a.code < b.code ? -1 : 1), plow: (a, b) => (a.jpy || 1e12) - (b.jpy || 1e12), phigh: (a, b) => (b.jpy || -1) - (a.jpy || -1), name: (a, b) => a.name.localeCompare(b.name), code: (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) }[f.sort];
  list.sort(key);
  return { list, noInfo };
}
const GRP_ORDER = { op: 3, eb: 2, prb: 1, st: 0 };
const setKeyOf = (id) => (GRP_ORDER[groupOf(id)] ?? 0) * 1000 + numOf(id);

export async function viewExplore($app) {
  const cat = await loadCatalog();
  if (state.user) await loadInv();
  const inv = state.inv || new Map();
  const f = Object.assign(FRESH(), JSON.parse(sessionStorage.getItem('xf') || '{}'));
  const save = () => sessionStorage.setItem('xf', JSON.stringify(f));
  let saleCodes = null, shown = 60;
  const owned = new Map();
  for (const [ref] of inv) { const c = cat.byRef.get(ref); if (c) (owned.get(c.set) || owned.set(c.set, new Set()).get(c.set)).add(c.code); }

  const chips = () => {
    const out = [];
    const add = (label, clear) => out.push([label, clear]);
    if (f.groups.length) add(f.groups.map((g) => GROUPS.find((x) => x[0] === g)[2]).join('/'), () => (f.groups = []));
    if (f.sets.length) add(f.sets.length > 2 ? `${f.sets.length} sets` : f.sets.map((s) => s.toUpperCase()).join('/'), () => (f.sets = []));
    if (f.rar.length) add('Rarity ' + f.rar.map((r) => (r === '-' ? 'DON!!' : r)).join('/'), () => (f.rar = []));
    if (f.col.length) add((f.colAll ? 'All of ' : '') + f.col.join('/'), () => (f.col = []));
    if (f.type.length) add(f.type.join('/'), () => (f.type = []));
    if (f.arts.length) add(f.arts.map((a) => ART[a][1]).join('/'), () => (f.arts = []));
    if (f.pmin !== '' || f.pmax !== '') add(`BND ${f.pmin || 0}–${f.pmax || '∞'}`, () => { f.pmin = f.pmax = ''; });
    if (f.cmin !== '' || f.cmax !== '') add(`Cost ${f.cmin || 0}–${f.cmax || '∞'}`, () => { f.cmin = f.cmax = ''; });
    if (f.wmin !== '' || f.wmax !== '') add(`Power ${f.wmin || 0}–${f.wmax || '∞'}`, () => { f.wmin = f.wmax = ''; });
    if (f.counter.length) add('Counter ' + f.counter.join('/'), () => (f.counter = []));
    if (f.life.length) add('Life ' + f.life.join('/'), () => (f.life = []));
    if (f.attr.length) add(f.attr.join('/'), () => (f.attr = []));
    if (f.trait) add('Trait: ' + f.trait, () => (f.trait = ''));
    if (f.kw.length) add(f.kw.join(', '), () => (f.kw = []));
    if (f.own !== 'all') add(f.own === 'owned' ? 'Owned' : 'Missing', () => (f.own = 'all'));
    if (f.sale) add('For sale now', () => (f.sale = false));
    return out;
  };

  async function ensureData() {
    if (f.sale && !saleCodes) { const { data } = await sb.from('listings').select('card_code').eq('status', 'active').limit(2000); saleCodes = new Set((data || []).map((l) => l.card_code)); }
    if (NEEDS_INFO(f)) await loadInfo();
  }

  const draw = async () => {
    save(); await ensureData();
    const n = activeCount(f), filtering = n > 0 || f.q.trim() !== '';
    const ch = chips();
    let body = '';
    if (!filtering) {
      body = GROUPS.map(([g, title]) => { const sets = cat.sets.filter((s) => groupOf(s.id) === g).sort((a, b) => numOf(b.id) - numOf(a.id)); if (!sets.length) return '';
        return `<div class="sec-h"><h2>${title}</h2><span class="muted">${sets.length} sets</span></div><div class="setgrid">${sets.map((s) => setCard(s, state.user ? ((owned.get(s.id)?.size || 0) / s.count) * 100 : null)).join('')}</div>`; }).join('');
    } else {
      const { list, noInfo } = apply(f, cat.cards, inv, saleCodes || new Set(), NEEDS_INFO(f) ? info : null);
      const page = list.slice(0, shown);
      body = `<div class="muted" style="margin:.2rem 0 .6rem"><b>${list.length}</b> card${list.length === 1 ? '' : 's'} found${noInfo ? ` · ${noInfo} newer cards have no stats yet and are hidden by stat filters` : ''}</div>
        <div class="grid">${page.map((c) => { const q = inv.get(c.ref); return `<a class="tile" href="#/card/${esc(c.code)}">${cardImg(c)}<div class="b"><div class="code">${esc(c.code)} · ${esc(c.rarity === '-' ? 'DON!!' : c.rarity)}${artShort(c) ? ' · ' + esc(artShort(c)) : ''}${q ? ` · ×${q}` : ''}</div><div class="nm">${esc(c.name)}</div><div class="price">${c.jpy ? bnd(refBnd(c)) : ''}</div></div></a>`; }).join('')}</div>
        ${list.length > shown ? `<p class="center"><button class="btn sec" id="more">Show more (${list.length - shown} left)</button></p>` : ''}${list.length ? '' : '<div class="panel empty"><p>No cards match these filters.</p><button class="btn" id="reset2">Clear filters</button></div>'}`;
    }
    $app.innerHTML = `<div class="head"><h1>Explore</h1></div>
      <div class="row tight" style="margin-bottom:.5rem"><input id="q" class="grow" placeholder="Search card name or code, e.g. Luffy, OP05-060" value="${esc(f.q)}" style="flex:1 1 220px"><button class="btn ${n ? '' : 'sec'}" id="fbtn">⚙ Filters${n ? ` (${n})` : ''}</button></div>
      ${ch.length ? `<div class="fchips">${ch.map(([l], i) => `<button class="fchip" data-i="${i}">${esc(l)} ✕</button>`).join('')}<button class="fchip clear" id="clr">Clear all</button></div>` : ''}
      ${body}`;
    const $ = (s) => $app.querySelector(s);
    $('#q').oninput = () => { f.q = $('#q').value; shown = 60; clearTimeout(draw.t); draw.t = setTimeout(async () => { await draw(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 280); };
    $('#fbtn').onclick = openFilters;
    $app.querySelectorAll('.fchip[data-i]').forEach((b) => (b.onclick = () => { ch[+b.dataset.i][1](); shown = 60; draw(); }));
    const reset = () => { Object.assign(f, FRESH(), { q: f.q }); shown = 60; draw(); };
    if ($('#clr')) $('#clr').onclick = reset; if ($('#reset2')) $('#reset2').onclick = reset;
    if ($('#more')) $('#more').onclick = () => { shown += 60; draw(); };
  };

  function openFilters() {
    const sh = sheet('<div id="fpanel"></div>'); const root = sh.el.querySelector('#fpanel');
    const chipRow = (key, items, multi = true) => items.map(([v, l, colour]) => `<button type="button" class="fc ${(multi ? f[key].includes(v) : f[key] === v) ? 'on' : ''}" data-k="${key}" data-v="${esc(v)}" ${colour ? `style="--cc:${colour}"` : ''}>${esc(l ?? v)}</button>`).join('');
    const render = async () => {
      await ensureData();
      const preview = apply(f, cat.cards, inv, saleCodes || new Set(), NEEDS_INFO(f) ? info : null).list.length;
      const traits = info ? [...new Set(Object.values(info).flatMap((d) => (d[5] || '').split('/').map((t) => t.trim()).filter(Boolean)))].sort() : [];
      root.innerHTML = `<h2>Filters</h2>
        <div class="fsec"><h3>Set type</h3><div class="fcs">${chipRow('groups', GROUPS.map((g) => [g[0], g[1]]))}</div></div>
        <div class="fsec"><h3>Set</h3><div class="fcs scrollx">${cat.sets.slice().sort((a, b) => setKeyOf(b.id) - setKeyOf(a.id)).map((s) => `<button type="button" class="fc ${f.sets.includes(s.id) ? 'on' : ''}" data-k="sets" data-v="${s.id}" title="${esc(s.name)}">${s.id.toUpperCase()}</button>`).join('')}</div></div>
        <div class="fsec"><h3>Rarity</h3><div class="fcs">${chipRow('rar', RARITIES.map(([v, l]) => [v, v === '-' ? 'DON!!' : `${v}`]))}</div><div class="muted">L leader · C common · UC uncommon · R rare · SR super rare · SEC secret · SP special · TR treasure · P-… alternate art · DON!! cards</div></div>
        <div class="fsec"><h3>Colour</h3><div class="fcs">${chipRow('col', COLOURS.map(([n, c]) => [n, n, c]))}</div><label class="inline"><input type="checkbox" id="colAll" ${f.colAll ? 'checked' : ''} style="width:auto"> Must have all selected colours (multicolour cards)</label></div>
        <div class="fsec"><h3>Card type</h3><div class="fcs">${chipRow('type', TYPES.map((t) => [t, t]))}</div></div>
        <div class="fsec"><h3>Art type</h3><div class="fcs">${chipRow('arts', Object.entries(ART).map(([k, v]) => [k, v[0]]))}</div><div class="muted">Manga = Japanese Super Parallel (Yuyutei label). Alternate art = other parallels. Foil = lame, pirate flag and stamped foils.</div></div>
        <div class="fsec"><h3>Reference price (BND)</h3><div class="row tight"><input type="number" id="pmin" min="0" step="0.5" placeholder="Min" value="${esc(f.pmin)}" style="max-width:110px"><span>to</span><input type="number" id="pmax" min="0" step="0.5" placeholder="Max" value="${esc(f.pmax)}" style="max-width:110px"></div></div>
        <div class="fsec"><h3>Cost</h3><div class="row tight"><input type="number" id="cmin" min="0" max="10" placeholder="Min" value="${esc(f.cmin)}" style="max-width:110px"><span>to</span><input type="number" id="cmax" min="0" max="10" placeholder="Max" value="${esc(f.cmax)}" style="max-width:110px"></div></div>
        <div class="fsec"><h3>Power</h3><div class="row tight"><input type="number" id="wmin" min="0" step="1000" placeholder="Min" value="${esc(f.wmin)}" style="max-width:110px"><span>to</span><input type="number" id="wmax" min="0" step="1000" placeholder="Max" value="${esc(f.wmax)}" style="max-width:110px"></div></div>
        <div class="fsec"><h3>Counter</h3><div class="fcs">${chipRow('counter', [['0', 'None'], ['1000', '+1000'], ['2000', '+2000']])}</div></div>
        <div class="fsec"><h3>Life (leaders)</h3><div class="fcs">${chipRow('life', [['3', '3'], ['4', '4'], ['5', '5']])}</div></div>
        <div class="fsec"><h3>Attribute</h3><div class="fcs">${chipRow('attr', ATTRS.map((a) => [a, a]))}</div></div>
        <div class="fsec"><h3>Trait / type</h3><input id="trait" list="traitlist" placeholder="e.g. Straw Hat Crew, Supernovas" value="${esc(f.trait)}"><datalist id="traitlist">${traits.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
        <div class="fsec"><h3>Effect keywords</h3><div class="fcs">${chipRow('kw', KEYWORDS.map((k) => [k, k]))}</div></div>
        ${state.user ? `<div class="fsec"><h3>My collection</h3><div class="fcs">${chipRow('own', [['all', 'All cards'], ['owned', 'Owned'], ['missing', 'Missing']], false)}</div></div>` : ''}
        <div class="fsec"><h3>Marketplace</h3><label class="inline"><input type="checkbox" id="sale" ${f.sale ? 'checked' : ''} style="width:auto"> Only cards for sale now</label></div>
        <div class="fsec"><h3>Sort by</h3><select id="sort">${SORTS.map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="fbar"><button class="btn sec" id="freset">Reset</button><button class="btn grow" id="fgo">Show ${preview} card${preview === 1 ? '' : 's'}</button></div>`;
      root.querySelectorAll('.fc').forEach((b) => (b.onclick = () => {
        const k = b.dataset.k, v = b.dataset.v;
        if (Array.isArray(f[k])) { f[k] = f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]; } else f[k] = v;
        if (k === 'own' && f.own !== 'all' && !state.inv) loadInv(); render();
      }));
      const bind = (id, key, isCheck) => { const el = root.querySelector('#' + id); if (!el) return; el.onchange = () => { f[key] = isCheck ? el.checked : el.value; render(); }; };
      ['pmin', 'pmax', 'cmin', 'cmax', 'wmin', 'wmax', 'trait'].forEach((k) => bind(k, k)); bind('colAll', 'colAll', true); bind('sale', 'sale', true); bind('sort', 'sort');
      root.querySelector('#freset').onclick = () => { Object.assign(f, FRESH(), { q: f.q }); render(); };
      root.querySelector('#fgo').onclick = () => { sh.close(); shown = 60; draw(); };
    };
    render();
  }
  await draw();
}
