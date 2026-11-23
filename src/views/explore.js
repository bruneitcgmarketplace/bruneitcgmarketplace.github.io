import { sb, state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, refBnd, cardImg, catImg, setName, tile, listingPrice, enlarge, colorDot, rpc } from '../lib.js';
import { setCircle } from './home.js';

const qs = () => new URLSearchParams(location.hash.split('?')[1] || '');

export async function viewExplore($app) {
  const cat = await loadCatalog();
  if (state.user) await loadInv();
  const owned = new Map();
  for (const [ref] of state.inv || []) { const c = cat.byRef.get(ref); if (c) (owned.get(c.set) || owned.set(c.set, new Set()).get(c.set)).add(c.code); }
  $app.innerHTML = `<h1>Card sets</h1><p class="muted">Browse every One Piece set. ${state.user ? 'Rings show how much of each set you own.' : 'Sign in to see how much of each set you own.'}</p><div class="setgrid">${cat.sets.map((s) => setCircle(s, state.user ? ((owned.get(s.id)?.size || 0) / s.count) * 100 : null)).join('')}</div>`;
}

export async function viewMarket($app) {
  const cat = await loadCatalog();
  const p = qs();
  const f = JSON.parse(sessionStorage.getItem('filters') || '{}');
  const type = p.get('type') ?? f.type ?? '';
  $app.innerHTML = `<h1>Marketplace</h1><p class="muted">Cards for sale by collectors in Brunei. Buy now or bid in auctions.</p>
    <div class="panel"><div class="row">
      <input id="q" placeholder="Search card code or name, e.g. OP01-001" value="${esc(f.q || '')}">
      <select id="type"><option value="">All types</option><option value="buy_now">Buy now</option><option value="auction">Auctions</option></select>
      <select id="sort"><option value="new">Newest</option><option value="end">Ending soon</option><option value="low">Price low</option><option value="high">Price high</option></select></div></div>
    <div id="list" class="grid"><p class="muted">Loading…</p></div>`;
  $app.querySelector('#type').value = type; $app.querySelector('#sort').value = f.sort || 'new';
  rpc('close_ended_auctions').catch(() => {});
  const load = async () => {
    const q = $app.querySelector('#q').value.trim(), t = $app.querySelector('#type').value, sort = $app.querySelector('#sort').value;
    sessionStorage.setItem('filters', JSON.stringify({ q, type: t, sort }));
    let req = sb.from('listings').select('*').eq('status', 'active').limit(120);
    if (t) req = req.eq('type', t);
    if (q) {
      const s = q.replace(/[%,()]/g, ' ');
      const codes = cat.cards.filter((c) => c.en.toLowerCase().includes(q.toLowerCase())).map((c) => c.code);
      const uniq = [...new Set(codes)].slice(0, 60);
      req = req.or([`card_code.ilike.%${s}%`, `card_name.ilike.%${s}%`, uniq.length ? `card_code.in.(${uniq.join(',')})` : null].filter(Boolean).join(','));
    }
    if (sort === 'end') req = req.eq('type', 'auction').order('ends_at');
    else if (sort === 'low') req = req.order('price', { nullsFirst: false });
    else if (sort === 'high') req = req.order('price', { ascending: false, nullsFirst: false });
    else req = req.order('created_at', { ascending: false });
    const { data, error } = await req;
    const el = $app.querySelector('#list'); if (!el) return;
    if (error) return (el.innerHTML = `<div class="notice err">${esc(error.message)}</div>`);
    el.innerHTML = data.length ? data.map(tile).join('') : '<p class="muted">No listings match. <a href="#/sell">Sell a card</a></p>';
  };
  let t; $app.querySelector('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  $app.querySelector('#type').onchange = load; $app.querySelector('#sort').onchange = load;
  load();
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
  const f = JSON.parse(sessionStorage.getItem('setf') || '{"q":"","alt":false,"own":"all","rar":""}');
  const rarities = [...new Set(set.cards.map((c) => c.rarity))];
  const draw = () => {
    const inv = state.inv || new Map();
    let cards = set.cards.filter((c) => (f.alt || c.def) && (!f.rar || c.rarity === f.rar)
      && (f.own === 'all' || (f.own === 'owned') === inv.has(c.ref)) && (!f.q || (c.code + ' ' + c.name + ' ' + c.jp).toLowerCase().includes(f.q.toLowerCase())));
    const ownedCodes = new Set([...inv.keys()].map((r) => cat.byRef.get(r)).filter((c) => c?.set === id).map((c) => c.code)).size;
    $app.innerHTML = `<p><a href="#/explore">← All sets</a></p><h1>${esc(set.name)}</h1><p class="muted">${id.toUpperCase()} · ${set.count} cards${state.user ? ` · you own ${ownedCodes} (${Math.round((ownedCodes / set.count) * 100)}%)` : ''}</p>
      <div class="panel"><div class="row"><input id="q" placeholder="Search in set" value="${esc(f.q)}">
        <select id="rar"><option value="">All rarities</option>${rarities.map((r) => `<option ${f.rar === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        ${state.user ? `<select id="own"><option value="all">All cards</option><option value="owned" ${f.own === 'owned' ? 'selected' : ''}>Owned</option><option value="missing" ${f.own === 'missing' ? 'selected' : ''}>Missing</option></select>` : ''}</div>
        <label class="inline"><input type="checkbox" id="alt" ${f.alt ? 'checked' : ''} style="width:auto"> Show alternate arts</label></div>
      <div class="grid">${cards.map((c) => { const fs = forSale.get(c.code), q = inv.get(c.ref);
        return `<a class="tile ${state.user && !q ? 'dim' : ''}" href="#/card/${esc(c.code)}">${cardImg(c)}<div class="b"><div class="code">${esc(c.code)} · ${esc(c.rarity)}${q ? ` · ×${q}` : ''}</div><div class="nm">${esc(c.name)}</div>
        <div class="muted">${c.jpy ? 'Ref ' + bnd(refBnd(c)) : ''}</div>${fs ? `<span class="badge bn">${fs.n} for sale from ${bnd(fs.min)}</span>` : ''}</div></a>`; }).join('')}</div>`;
    const $ = (s) => $app.querySelector(s);
    const upd = () => { f.q = $('#q').value; f.rar = $('#rar').value; f.alt = $('#alt').checked; if ($('#own')) f.own = $('#own').value; sessionStorage.setItem('setf', JSON.stringify(f)); };
    $('#q').oninput = () => { upd(); clearTimeout(draw.t); draw.t = setTimeout(() => { draw(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
    $('#rar').onchange = () => { upd(); draw(); }; $('#alt').onchange = () => { upd(); draw(); }; if ($('#own')) $('#own').onchange = () => { upd(); draw(); };
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
  const { data: ls } = await sb.from('listings').select('*').eq('status', 'active').eq('card_code', code).order('created_at', { ascending: false });
  const inv = state.inv || new Map();
  $app.innerHTML = `<p><a href="#/set/${main.set}">← ${esc(setName(main.set))}</a></p>
    <div class="detail"><div><img class="main" id="mainimg" src="${esc(catImg(main))}" alt="" onerror="this.style.visibility='hidden'">
      ${variants.length > 1 ? `<div class="thumbs">${variants.map((v) => `<img data-ref="${esc(v.ref)}" src="${esc(catImg(v, '100_140'))}" title="${esc(v.rarity)}" class="${v.ref === main.ref ? 'on' : ''}">`).join('')}</div>` : ''}</div>
    <div><h1>${esc(main.name)}</h1><p class="muted">${esc(code)} · ${colorDot(main.color)} ${esc(main.color || '')} ${esc(main.type || '')}</p>
      ${main.jp ? `<p class="muted">${esc(main.jp)}</p>` : ''}
      <div class="panel" id="vinfo"></div>
      <div class="row tight" id="vact"></div></div></div>
    <div class="sec-h"><h2>For sale (${ls?.length || 0})</h2></div>
    <div class="grid">${(ls || []).map(tile).join('') || '<p class="muted">Nobody is selling this card right now.</p>'}</div>`;
  let cur = main;
  const show = (v) => {
    cur = v;
    $app.querySelector('#mainimg').src = catImg(v);
    $app.querySelectorAll('.thumbs img').forEach((i) => i.classList.toggle('on', i.dataset.ref === v.ref));
    $app.querySelector('#vinfo').innerHTML = `<b>${esc(v.rarity)}</b> ${v.parallel ? '· alternate art' : ''}<br><span class="price">${v.jpy ? bnd(refBnd(v)) : 'No price'}</span> <span class="muted">reference${v.jpy ? ` (¥${v.jpy.toLocaleString()} Yuyutei)` : ''}</span>${state.user ? `<br>You own: <b>${inv.get(v.ref) || 0}</b>` : ''}`;
    $app.querySelector('#vact').innerHTML = `${state.user ? `<button class="btn sec" id="addinv">+ Add to inventory</button>` : ''}<a class="btn" href="#/sell/${esc(v.ref)}">Sell this card</a><button class="btn sec" id="zoom">Enlarge</button>`;
    const a = $app.querySelector('#addinv'); if (a) a.onclick = guard(async () => { await invAdjust(v.ref, 1); toast('Added to inventory'); show(v); });
    $app.querySelector('#zoom').onclick = () => enlarge(v);
  };
  $app.querySelectorAll('.thumbs img').forEach((i) => (i.onclick = () => show(cat.byRef.get(i.dataset.ref))));
  show(main);
}
