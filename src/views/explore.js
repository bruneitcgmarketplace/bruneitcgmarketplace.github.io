import { sb, state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, refBnd, cardImg, catImg, sharpen, setName, tile, listingPrice, enlarge, colorDot, rpc, ART, yuyuCard } from '../lib.js';
import { fallbackNote } from '../fallback.js';

const qs = () => new URLSearchParams(location.hash.split('?')[1] || '');

export { viewExplore } from './exploreSets.js';

export async function viewMarket($app, setUnsub) {
  const cat = await loadCatalog();
  const p = qs();
  const f = JSON.parse(sessionStorage.getItem('filters') || '{}');
  let type = (p.get('type') ?? f.type) === 'auction' ? 'auction' : 'buy_now';   // two sub pages, no "All"
  $app.innerHTML = `<h1>Marketplace</h1><p class="muted">Cards for sale by collectors in Brunei. Buy now or bid in auctions.</p>
    <div class="seg" id="mt"><a data-t="buy_now">Buy now</a><a data-t="auction">Auction</a></div>
    <div class="panel"><div class="row">
      <input id="q" placeholder="Search card code or name, e.g. OP01-001" value="${esc(f.q || '')}">
      <select id="sort"></select></div></div>
    <div id="list" class="grid"><p class="muted">Loading…</p></div>`;
  const setTab = (pref) => {
    $app.querySelectorAll('#mt a').forEach((a) => a.classList.toggle('on', a.dataset.t === type));
    const s = $app.querySelector('#sort');
    s.innerHTML = (type === 'auction' ? '<option value="end">Ending soon</option>' : '') + '<option value="new">Newest</option><option value="low">Price low</option><option value="high">Price high</option>';
    s.value = [...s.options].some((o) => o.value === pref) ? pref : (type === 'auction' ? 'end' : 'new');
  };
  setTab(f.sort);
  rpc('close_ended_auctions').catch(() => {});
  const load = async () => {
    const q = $app.querySelector('#q').value.trim(), t = type, sort = $app.querySelector('#sort').value;
    sessionStorage.setItem('filters', JSON.stringify({ q, type: t, sort }));
    let req = sb.from('listings').select('*').or('status.eq.active,and(status.eq.reserved,type.eq.buy_now)').limit(120);
    req = req.eq('type', t);
    if (q) {
      const s = q.replace(/[%,()]/g, ' ');
      const codes = cat.cards.filter((c) => c.en.toLowerCase().includes(q.toLowerCase())).map((c) => c.code);
      const uniq = [...new Set(codes)].slice(0, 60);
      req = req.or([`card_code.ilike.%${s}%`, `card_name.ilike.%${s}%`, uniq.length ? `card_code.in.(${uniq.join(',')})` : null].filter(Boolean).join(','));
    }
    req = sort === 'end' ? req.order('ends_at') : req.order('created_at', { ascending: false });   // price sorts run below (auction price = current bid)
    const { data, error } = await req;
    const el = $app.querySelector('#list'); if (!el) return;
    if (error) return (el.innerHTML = `<div class="notice err">${esc(error.message)}</div>`);
    const rows = [...data];
    if (sort === 'low') rows.sort((a, b) => listingPrice(a) - listingPrice(b)); else if (sort === 'high') rows.sort((a, b) => listingPrice(b) - listingPrice(a));
    rows.sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved'));   // held cards last (stable)
    el.innerHTML = rows.length ? rows.map(tile).join('') : `<p class="muted">${t === 'auction' ? 'No live auctions match.' : 'No buy-now listings match.'} <a href="#/sell">Sell a card</a></p>`;
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
  const { data: ls } = await sb.from('listings').select('*').or('status.eq.active,and(status.eq.reserved,type.eq.buy_now)').eq('card_code', code).order('created_at', { ascending: false });
  const inv = state.inv || new Map();
  $app.innerHTML = `<p><a href="#/set/${main.set}">← ${esc(setName(main.set))}</a></p>
    <div class="detail"><div><img class="main" id="mainimg" src="${esc(catImg(main))}" alt="${esc(main.code)}" onerror="this.style.visibility='hidden'">
      ${variants.length > 1 ? `<div class="thumbs">${variants.map((v) => `<img data-ref="${esc(v.ref)}" src="${esc(catImg(v, '100_140'))}" title="${esc(v.rarity)}${v.art && v.art !== "std" ? " · " + esc(ART[v.art][1]) : ""}" class="${v.ref === main.ref ? 'on' : ''}">`).join('')}</div>` : ''}<p class="muted" id="ysrc" style="word-break:break-all;margin:.5rem 0 0"></p></div>
    <div><h1>${esc(main.name)}</h1><p class="muted">${esc(code)} · ${colorDot(main.color)} ${esc(main.color || '')} ${esc(main.type || '')}</p>
      ${main.jp ? `<p class="muted">${esc(main.jp)}</p>` : ''}
      <div class="panel" id="vinfo"></div>
      <div class="row tight" id="vact"></div></div></div>
    <div class="sec-h"><h2>For sale (${(ls || []).filter((l) => l.status === 'active').length})</h2></div>
    <div class="grid">${[...(ls || [])].sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved')).map(tile).join('') || '<p class="muted">Nobody is selling this card right now.</p>'}</div>`;
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
