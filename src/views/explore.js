import { sheet, sb, state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, refBnd, cardImg, catImg, sharpen, setName, tile, listingPrice, enlarge, colorDot, rpc, ART, yuyuCard, primeMeta, groupBuyNow, listRow } from '../lib.js';
import { fallbackNote } from '../fallback.js';
import { shareChoice } from './shared.js';
import { filterSheet, FRESH, activeCount, matchSync, needsInfo, loadInfo } from './exploreSets.js';

const qs = () => new URLSearchParams(location.hash.split('?')[1] || '');

export { viewExplore } from './exploreSets.js';

export async function viewMarket($app, setUnsub) {
  const cat = await loadCatalog();
  const p = qs();
  const f = JSON.parse(sessionStorage.getItem('filters') || '{}');
  let type = (p.get('type') ?? f.type) === 'auction' ? 'auction' : 'buy_now';   // two sub pages, no "All"
  if (state.user) await loadInv();
  const inv = state.inv || new Map();
  const mf = Object.assign(FRESH(), JSON.parse(sessionStorage.getItem('mf') || '{}'), { q: '', sale: false });   // same filters as Explore
  let pool = [];   // listings of the current tab, before filters
  let view = localStorage.getItem('view_mkt') || 'grid';
  const applyView = () => { const el = $app.querySelector('#list'); if (el) el.className = view === 'list' ? 'lrows' : view === 'tiles' ? 'grid tiles' : 'grid'; $app.querySelectorAll('#vsw button').forEach((b) => b.classList.toggle('on', b.dataset.v === view)); };
  let sel = new Set(JSON.parse(sessionStorage.getItem('msel2') || '[]'));   // chosen seller ids (empty = all)
  let sellers = new Map();   // id -> { name, n } for this tab
  let curRows = [];
  let selMode = false; const pick = new Set();   // chosen listing ids (the first id of a combined group)   // what the page currently shows (after filters, grouping, sort)
  $app.innerHTML = `<div class="head" style="margin-bottom:.4rem"><h1 style="margin:0">Marketplace</h1><div class="row tight"><button class="btn sec" id="msel">☑ Select</button><button class="btn sec" id="mshare">🔗 Share</button></div></div>
    <div class="seg" id="mt"><a data-t="buy_now">Buy now</a><a data-t="auction">Auction</a></div>
    <div class="mbar">
      <input id="q" type="search" placeholder="Search code or name" value="${esc(f.q || '')}">
      <button class="btn sec" id="fbtn">⚙ Filters</button>
      <div class="two"><select id="sort" aria-label="Sort by"></select><button class="btn sec" id="seller" type="button" aria-label="Sellers">All sellers</button><div class="vsw" id="vsw" role="group" aria-label="View"><button data-v="list" title="List" aria-label="List view">☰</button><button data-v="grid" title="Grid" aria-label="Grid view">▦</button><button data-v="tiles" title="Tiles" aria-label="Tiles view">▪▪▪</button></div></div></div>
    <label class="mall" id="mpall" hidden><span class="mk" id="mpmk"></span><b id="mpmt">Select all</b></label>
    <div id="list" class="grid"><p class="muted">Loading…</p></div>
    <div class="pickbar" id="mpbar" hidden><button class="btn" id="mpgo" disabled>Share selected (0)</button></div>`;
  const setTab = (pref) => {
    $app.querySelectorAll('#mt a').forEach((a) => a.classList.toggle('on', a.dataset.t === type));
    const s = $app.querySelector('#sort');
    s.innerHTML = (type === 'auction' ? '<option value="end">Ending soon</option>' : '') + '<option value="new">Newest</option><option value="low">Price low</option><option value="high">Price high</option><option value="rating">Top rated sellers</option>';
    s.value = [...s.options].some((o) => o.value === pref) ? pref : (type === 'auction' ? 'end' : 'new');
  };
  setTab(f.sort);
  const fbtn = $app.querySelector('#fbtn');
  const btnLabel = () => { const n = activeCount(mf); fbtn.className = 'btn ' + (n ? '' : 'sec'); fbtn.textContent = '⚙ Filters' + (n ? ` (${n})` : ''); };
  btnLabel();
  const ensureData = async () => { if (needsInfo(mf)) await loadInfo(); };
  const matchRefs = (rows) => { const cards = [...new Map(rows.map((l) => [l.card_ref, cat.byRef.get(l.card_ref)]).filter(([, c]) => c)).values()]; return new Set(matchSync(mf, cards, inv).map((c) => c.ref)); };
  // only sellers who have something for sale in this tab
  const saveSel = () => sessionStorage.setItem('msel2', JSON.stringify([...sel]));
  const sellerLabel = () => { const b = $app.querySelector('#seller'); const n = sel.size; b.textContent = !n ? `All sellers (${sellers.size})` : n === 1 ? [...sel].map((i) => sellers.get(i)?.name || 'Seller')[0] : `${n} sellers`; b.className = 'btn ' + (n ? '' : 'sec'); };
  const fillSellers = () => {
    sellers = new Map();
    for (const l of pool) { const e = sellers.get(l.seller_id) || { name: l.seller?.display_name || 'Seller', n: 0 }; e.n++; sellers.set(l.seller_id, e); }
    for (const id of [...sel]) if (!sellers.has(id)) sel.delete(id);
    sellerLabel();
  };
  const base = () => (sel.size ? pool.filter((l) => sel.has(l.seller_id)) : pool);
  // spreadsheet-style picker: type to search, tick several sellers
  function sellerSheet() {
    const draft = new Set(sel);
    const sh = sheet('<div id="slp"></div>'); const root = sh.el.querySelector('#slp');
    const list = [...sellers].sort((a, b) => a[1].name.localeCompare(b[1].name));
    root.innerHTML = `<h2>Sellers</h2><input id="sq" type="search" placeholder="Type to search sellers" autocomplete="off">
      <div class="row tight" style="margin:.4rem 0"><button class="btn sec sm-btn" id="sall" type="button">Select all shown</button><button class="btn sec sm-btn" id="sclr" type="button">Clear</button><span class="muted" id="scnt"></span></div>
      <div class="slist" id="sl"></div>
      <div class="fbar"><button class="btn sec" id="sno" type="button">Cancel</button><button class="btn grow" id="sok" type="button">Apply</button></div>`;
    const q = (s) => root.querySelector(s);
    const shown = () => { const t = q('#sq').value.trim().toLowerCase(); return list.filter(([, e]) => !t || e.name.toLowerCase().includes(t)); };
    const draw = () => {
      const rows = shown();
      q('#sl').innerHTML = rows.map(([id, e]) => `<label class="sli"><input type="checkbox" data-id="${esc(id)}" ${draft.has(id) ? 'checked' : ''}><span class="sn">${esc(e.name)}</span><span class="muted">${e.n}</span></label>`).join('') || '<p class="muted">No sellers match.</p>';
      q('#scnt').textContent = `${draft.size} selected`;
      q('#sl').querySelectorAll('input').forEach((c) => (c.onchange = () => { c.checked ? draft.add(c.dataset.id) : draft.delete(c.dataset.id); q('#scnt').textContent = `${draft.size} selected`; }));
    };
    q('#sq').oninput = draw;
    q('#sall').onclick = () => { shown().forEach(([id]) => draft.add(id)); draw(); };
    q('#sclr').onclick = () => { draft.clear(); draw(); };
    q('#sno').onclick = () => sh.close();
    q('#sok').onclick = () => { sel = draft; saveSel(); sellerLabel(); sh.close(); paint(); };
    draw();
  }
  $app.querySelector('#seller').onclick = sellerSheet;
  $app.querySelectorAll('#vsw button').forEach((b) => (b.onclick = () => { view = b.dataset.v; localStorage.setItem('view_mkt', view); paint(true); }));
  function updBar() {
    const bar = $app.querySelector('#mpbar'); bar.hidden = !selMode;
    $app.querySelector('#msel').className = 'btn ' + (selMode ? '' : 'sec'); $app.querySelector('#msel').textContent = selMode ? '☑ Done' : '☑ Select';
    const n = curRows.filter((l) => pick.has(l.id)).length, go = $app.querySelector('#mpgo');
    go.textContent = `Share selected (${n})`; go.disabled = !n; go.className = 'btn' + (n ? '' : ' sec');
    const full = curRows.length > 0 && n === curRows.length;
    $app.querySelector('#mpall').hidden = !selMode; $app.querySelector('#mpmk').textContent = full ? '✓' : n ? '–' : '';
    $app.querySelector('#mpmt').textContent = full ? `Unselect all (${curRows.length})` : `Select all (${curRows.length})`;
  }
  function decorate() {
    const el = $app.querySelector('#list'); el.classList.toggle('selmode', selMode);
    if (selMode) el.querySelectorAll('a.tile, a.lrow').forEach((a) => {
      const id = a.getAttribute('href').split('/').pop(), on = pick.has(id);
      a.classList.toggle('picked', on); a.insertAdjacentHTML('afterbegin', `<span class="mk">${on ? '✓' : ''}</span>`);
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (pick.has(id)) pick.delete(id); else pick.add(id); a.classList.toggle('picked', pick.has(id)); a.querySelector('.mk').textContent = pick.has(id) ? '✓' : ''; updBar(); };
    });
    updBar();
  }
  const pagerHtml = (pg, pages, from, n, total) => `<div class="pager" style="grid-column:1/-1"><button class="btn sec" data-pg="${pg - 1}" ${pg === 0 ? 'disabled' : ''}>◀ Previous</button><span class="pginfo"><b>Page ${pg + 1} of ${pages}</b><small>${from + 1}–${from + n} of ${total}</small></span><button class="btn" data-pg="${pg + 1}" ${pg >= pages - 1 ? 'disabled' : ''}>Next ▶</button></div>`;
  let page = 0; const PAGE = 50;   // listings per page
  function paint(keep) {
    if (!keep) page = 0;
    const el = $app.querySelector('#list'); if (!el) return;
    const sort = $app.querySelector('#sort').value;
    let rows = base();
    if (activeCount(mf)) { const ok = matchRefs(rows); rows = rows.filter((l) => ok.has(l.card_ref)); }
    rows = [...rows];
    if (sort === 'low') rows.sort((a, b) => listingPrice(a) - listingPrice(b)); else if (sort === 'high') rows.sort((a, b) => listingPrice(b) - listingPrice(a));
    else if (sort === 'rating') { const sc = (l) => { const m = state.umeta.get(l.seller_id); return m && m.n ? m.avg + Math.min(m.n, 20) / 100 : -1; }; rows.sort((a, b) => sc(b) - sc(a)); }   // best average first, more reviews break ties
    if (type === 'buy_now') rows = groupBuyNow(rows);   // identical offers -> one tile with a quantity
    rows.sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved'));   // held cards last (stable)
    curRows = rows;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE)); page = Math.min(page, pages - 1);
    const from = page * PAGE, total = rows.length; rows = rows.slice(from, from + PAGE);
    applyView();
    const draw1 = view === 'list' ? listRow : tile;
    el.innerHTML = rows.length ? rows.map(draw1).join('') + (pages > 1 ? pagerHtml(page, pages, from, rows.length, total) : '')
      : `<p class="muted">${activeCount(mf) || sel.size ? 'Nothing matches these filters.' : type === 'auction' ? 'No live auctions match.' : 'No buy-now listings match.'} ${activeCount(mf) || sel.size ? '<a href="#" id="fclr">Clear filters</a>' : '<a href="#/sell">Sell a card</a>'}</p>`;
    decorate();
    el.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { page = Number(b.dataset.pg); paint(true); const top = $app.querySelector('#mt'); if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    const c = el.querySelector('#fclr'); if (c) c.onclick = (ev) => { ev.preventDefault(); Object.assign(mf, FRESH(), { q: '' }); sel = new Set(); saveSel(); sessionStorage.setItem('mf', JSON.stringify(mf)); sellerLabel(); btnLabel(); paint(); };
  }
  fbtn.onclick = () => filterSheet({ f: mf, cat, ensureData, market: true, unit: 'listing',
    count: () => { const b = base(); const f = activeCount(mf) ? b.filter((l) => matchRefs(b).has(l.card_ref)) : b; return type === 'buy_now' ? groupBuyNow(f).length : f.length; },
    done: () => { sessionStorage.setItem('mf', JSON.stringify(mf)); btnLabel(); paint(); } });
  const buildShare = (rows) => {
    const base = `${location.origin}${location.pathname}#/`;
    const n = (l) => (l._ids ? l._ids.length : 1);
    const where = type === 'auction' ? 'Auctions' : 'Buy now';
    const one = sel.size === 1 ? [...sel][0] : null, sname = one ? sellers.get(one)?.name : '';
    const lines = rows.slice(0, 15).map((l) => `• ${l.card_code} ${l.rarity || ''} ${l.card_name || ''}${n(l) > 1 ? ' ×' + n(l) : ''} · ${bnd(listingPrice(l))}${l.seller?.display_name && !one ? ' · ' + l.seller.display_name : ''}\n  ${base}listing/${l.id}`);
    const link = one ? `${base}user/${one}` : `${base}market?type=${type}`;
    const text = `${where} on Brunei One Piece TCG${sname ? ' from ' + sname : ''} (${rows.length} listing${rows.length === 1 ? '' : 's'}${activeCount(mf) ? ', filtered' : ''}):\n${lines.join('\n')}${rows.length > 15 ? `\n…and ${rows.length - 15} more` : ''}\n\n${one ? 'All from this seller' : 'Marketplace'}: ${link}`;
    const pics = rows.map((l) => { const c = cat.byRef.get(l.card_ref); return { url: c ? catImg(c, '200_280') : (l.catalog_image || ''), qty: n(l) > 1 ? `×${n(l)}` : '', price: 'BND ' + listingPrice(l).toFixed(2) }; }).filter((x) => x.url);
    return { text, pics, sub: `${where}${sname ? ' · ' + sname : ''}${activeCount(mf) ? ' · filtered' : ''}`, link, ttl: sname ? `${sname} Listings` : `Marketplace · ${where}` };
  };
  const openShare = () => {
    if (!curRows.length) { toast('Nothing to share'); return; }
    shareChoice({ title: 'Share marketplace', selCount: curRows.filter((l) => pick.has(l.id)).length, build: async (kind) => buildShare(kind === 'selected' ? curRows.filter((l) => pick.has(l.id)) : curRows) });
  };
  $app.querySelector('#mshare').onclick = openShare;
  $app.querySelector('#mpgo').onclick = openShare;
  $app.querySelector('#msel').onclick = () => { selMode = !selMode; paint(true); };
  $app.querySelector('#mpall').onclick = (e) => { e.preventDefault(); const all = curRows.length && curRows.every((l) => pick.has(l.id)); curRows.forEach((l) => (all ? pick.delete(l.id) : pick.add(l.id))); paint(true); };
  rpc('close_ended_auctions').catch(() => {});
  const load = async () => {
    const q = $app.querySelector('#q').value.trim(), t = type, sort = $app.querySelector('#sort').value;
    sessionStorage.setItem('filters', JSON.stringify({ q, type: t, sort }));
    let req = sb.from('listings').select('*, seller:profiles!listings_seller_id_fkey(display_name)').or('status.eq.active,and(status.eq.reserved,type.eq.buy_now)');
    req = req.eq('type', t);
    if (q) {
      const s = q.replace(/[%,()]/g, ' ');
      const codes = cat.cards.filter((c) => c.en.toLowerCase().includes(q.toLowerCase())).map((c) => c.code);
      const uniq = [...new Set(codes)].slice(0, 60);
      req = req.or([`card_code.ilike.%${s}%`, `card_name.ilike.%${s}%`, uniq.length ? `card_code.in.(${uniq.join(',')})` : null].filter(Boolean).join(','));
    }
    req = sort === 'end' ? req.order('ends_at') : req.order('created_at', { ascending: false }).order('id');   // price sorts run below (auction price = current bid)
    let data = [], error = null;
    for (let from = 0; from < 5000; from += 1000) {   // the server returns at most 1000 rows per request
      const r = await req.range(from, from + 999);
      if (r.error) { error = r.error; break; }
      data = data.concat(r.data || []); if ((r.data || []).length < 1000) break;
    }
    const el = $app.querySelector('#list'); if (!el) return;
    if (error) return (el.innerHTML = `<div class="notice err">${esc(error.message)}</div>`);
    pool = [...data];
    await primeMeta(pool);
    fillSellers();
    await ensureData();
    paint();
  };
  let t; $app.querySelector('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  $app.querySelector('#sort').onchange = load;
  $app.querySelectorAll('#mt a').forEach((a) => (a.onclick = () => {
    if (a.dataset.t === type) return;
    type = a.dataset.t; history.replaceState(null, '', `#/market?type=${type}`);
    setTab(null); $app.querySelector('#list').innerHTML = '<p class="muted">Loading…</p>'; load();
  }));
  load();
  // a card goes grey the moment another buyer clicks Buy now (and back to normal if the hold is released)
  if (setUnsub) {
    let rt; const ch = sb.channel('market-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, () => { clearTimeout(rt); rt = setTimeout(load, 500); }).subscribe();
    setUnsub(() => { clearTimeout(rt); sb.removeChannel(ch); });
  }
}

// ---------- set page ----------
export async function viewSet($app, id) {
  const cat = await loadCatalog();
  const set = cat.sets.find((s) => s.id === id);
  if (!set) { $app.innerHTML = '<div class="notice err">Unknown set</div>'; return; }
  if (state.user) await loadInv();
  const { data: ls } = await sb.from('listings').select('card_code,type,price,current_bid,start_price').eq('status', 'active').in('card_code', [...new Set(set.cards.map((c) => c.code))].slice(0, 400));
  const forSale = new Map();
  for (const l of ls || []) { const o = forSale.get(l.card_code) || { n: 0, min: Infinity }; o.n++; o.min = Math.min(o.min, listingPrice(l)); forSale.set(l.card_code, o); }
  const f = Object.assign({ q: '', art: '', own: 'all', rar: '', sort: 'code' }, JSON.parse(sessionStorage.getItem('setf') || '{}'));
  const SORT = { code: null, phigh: (a, b) => (b.jpy || -1) - (a.jpy || -1), plow: (a, b) => (a.jpy || 1e12) - (b.jpy || 1e12), name: (a, b) => a.name.localeCompare(b.name) };
  const rarities = [...new Set(set.cards.map((c) => c.rarity))];
  const artCount = new Map(); for (const c of set.cards) artCount.set(c.art || 'std', (artCount.get(c.art || 'std') || 0) + 1);
  const artTypes = Object.keys(ART).filter((k) => artCount.has(k));
  if (f.art && !artCount.has(f.art)) f.art = '';
  const draw = () => {
    const inv = state.inv || new Map();
    let cards = set.cards.filter((c) => (!f.rar || c.rarity === f.rar) && (!f.art || (c.art || 'std') === f.art)
      && (f.own === 'all' || (f.own === 'owned') === inv.has(c.ref)) && (!f.q || (c.code + ' ' + c.name + ' ' + c.jp).toLowerCase().includes(f.q.toLowerCase())));
    if (SORT[f.sort]) cards = cards.slice().sort(SORT[f.sort]);
    const ownedCodes = new Set([...inv.keys()].map((r) => cat.byRef.get(r)).filter((c) => c?.set === id).map((c) => c.code)).size;
    $app.innerHTML = `<p><a href="#/explore">← All sets</a></p><h1>${esc(set.name)}</h1><p class="muted">${id.toUpperCase()} · ${set.count} cards · ${set.cards.length} versions${state.user ? ` · you own ${ownedCodes} (${Math.round((ownedCodes / set.count) * 100)}%)` : ''}</p>
      <div class="panel"><div class="row"><input id="q" placeholder="Search in set" value="${esc(f.q)}">
        <select id="sortc" aria-label="Sort by"><option value="code">↕ Card number</option><option value="phigh" ${f.sort === 'phigh' ? 'selected' : ''}>↕ Price high to low</option><option value="plow" ${f.sort === 'plow' ? 'selected' : ''}>↕ Price low to high</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>↕ Name A to Z</option></select>
        <select id="rar"><option value="">All rarities</option>${rarities.map((r) => `<option ${f.rar === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        <select id="art" aria-label="Art type"><option value="">All art types</option>${artTypes.map((k) => `<option value="${k}" ${f.art === k ? 'selected' : ''}>${esc(ART[k][1])} (${artCount.get(k)})</option>`).join('')}</select>
        ${state.user ? `<select id="own"><option value="all">All cards</option><option value="owned" ${f.own === 'owned' ? 'selected' : ''}>Owned</option><option value="missing" ${f.own === 'missing' ? 'selected' : ''}>Missing</option></select>` : ''}</div></div>
      <div class="grid">${cards.map((c) => { const fs = forSale.get(c.code), q = inv.get(c.ref);
        return `<a class="tile ${state.user && !q ? 'dim' : ''}" href="#/card/${esc(c.code)}">${cardImg(c)}<div class="b"><div class="code">${esc(c.code)} · ${esc(c.rarity)}${q ? ` · ×${q}` : ''}</div><div class="nm">${esc(c.name)}</div>
        <div class="muted">${c.jpy ? 'Ref ' + bnd(refBnd(c)) : ''}</div>${fs ? `<span class="badge bn">${fs.n} for sale from ${bnd(fs.min)}</span>` : ''}</div></a>`; }).join('')}</div>`;
    const $ = (s) => $app.querySelector(s);
    const upd = () => { f.q = $('#q').value; f.rar = $('#rar').value; f.art = $('#art').value; f.sort = $('#sortc').value; if ($('#own')) f.own = $('#own').value; sessionStorage.setItem('setf', JSON.stringify(f)); };
    $('#q').oninput = () => { upd(); clearTimeout(draw.t); draw.t = setTimeout(() => { draw(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
    $('#rar').onchange = () => { upd(); draw(); }; $('#art').onchange = () => { upd(); draw(); }; $('#sortc').onchange = () => { upd(); draw(); }; if ($('#own')) $('#own').onchange = () => { upd(); draw(); };
  };
  draw();
}

// ---------- card page ----------
export async function viewCard($app, code) {
  const cat = await loadCatalog();
  const variants = cat.byCode.get(code);
  if (!variants) { $app.innerHTML = '<div class="notice err">Unknown card</div>'; return; }
  if (state.user) await loadInv();
  const main = variants.find((c) => c.def) || variants[0];
  const { data: ls } = await sb.from('listings').select('*, seller:profiles!listings_seller_id_fkey(display_name)').or('status.eq.active,and(status.eq.reserved,type.eq.buy_now)').eq('card_code', code).order('created_at', { ascending: false });
  await primeMeta(ls);
  const inv = state.inv || new Map();
  $app.innerHTML = `<p><a href="#/set/${main.set}">← ${esc(setName(main.set))}</a></p>
    <div class="detail"><div><img class="main" id="mainimg" src="${esc(catImg(main))}" alt="${esc(main.code)}" onerror="this.style.visibility='hidden'">
      ${variants.length > 1 ? `<div class="thumbs">${variants.map((v) => `<img data-ref="${esc(v.ref)}" src="${esc(catImg(v, '100_140'))}" title="${esc(v.rarity)}${v.art && v.art !== "std" ? " · " + esc(ART[v.art][1]) : ""}" class="${v.ref === main.ref ? 'on' : ''}">`).join('')}</div>` : ''}<p class="muted" id="ysrc" style="word-break:break-all;margin:.5rem 0 0"></p></div>
    <div><h1>${esc(main.name)}</h1><p class="muted">${esc(code)} · ${colorDot(main.color)} ${esc(main.color || '')} ${esc(main.type || '')}</p>
      ${main.jp ? `<p class="muted">${esc(main.jp)}</p>` : ''}
      <div class="panel" id="vinfo"></div>
      <div class="row tight" id="vact"></div></div></div>
    <div class="sec-h"><h2>For sale (${(ls || []).filter((l) => l.status === 'active').length})</h2></div>
    <div class="grid">${groupBuyNow([...(ls || [])].sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved'))).map(tile).join('') || '<p class="muted">Nobody is selling this card right now.</p>'}</div>`;
  let cur = main;
  const show = (v) => {
    cur = v;
    const yu = yuyuCard(v.set, v.num);
    $app.querySelector('#ysrc').innerHTML = `Source: <a href="${esc(yu)}" target="_blank" rel="noopener">${esc(yu.replace('https://', ''))} ↗</a><br><span class="muted">If the photo is missing here, open this page on Yuyutei.</span>${fallbackNote(v.set, v.num) ? `<br><span class="muted">Photo: ${esc(fallbackNote(v.set, v.num))}.</span>` : ''}`;
    const mi = $app.querySelector('#mainimg'); mi.removeAttribute('data-fb'); mi.removeAttribute('data-missing'); mi.style.visibility = ''; mi.src = catImg(v); sharpen(mi, catImg(v, 'front'));
    $app.querySelectorAll('.thumbs img').forEach((i) => i.classList.toggle('on', i.dataset.ref === v.ref));
    $app.querySelector('#vinfo').innerHTML = `<b>${esc(v.rarity)}</b> ${v.art && v.art !== 'std' ? '· ' + ART[v.art][0] : ''}<br><span class="price">${v.jpy ? bnd(refBnd(v)) : 'No price'}</span> <span class="muted">reference${v.jpy ? ` (¥${v.jpy.toLocaleString()} <a href="${esc(yuyuCard(v.set, v.num))}" target="_blank" rel="noopener">Yuyutei ↗</a>)` : ''}</span>${state.user ? `<br>You own: <b>${inv.get(v.ref) || 0}</b>` : ''}`;
    $app.querySelector('#vact').innerHTML = `${state.user ? `<button class="btn sec" id="addinv">+ Add to inventory</button>` : ''}<a class="btn" href="#/sell/${esc(v.ref)}">Sell this card</a><button class="btn sec" id="zoom">Enlarge</button><a class="btn sec" target="_blank" rel="noopener" href="${esc(yuyuCard(v.set, v.num))}">🔗 View on Yuyutei</a>`;
    const a = $app.querySelector('#addinv'); if (a) a.onclick = guard(async () => { await invAdjust(v.ref, 1); toast('Added to inventory'); show(v); });
    $app.querySelector('#zoom').onclick = () => enlarge(v);
  };
  $app.querySelectorAll('.thumbs img').forEach((i) => (i.onclick = () => show(cat.byRef.get(i.dataset.ref))));
  show(main);
}
