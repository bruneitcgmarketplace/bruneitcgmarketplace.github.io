import { sb, state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, invStats, refBnd, cardImg, setName, cardPicker, needLogin, bindLogin, enlarge, confirmSheet, artShort } from '../lib.js';
import { openShareSheet } from './shared.js';

export async function viewInventory($app) {
  if (!state.user) { $app.innerHTML = `<h1>Inventory</h1>${needLogin('track your collection')}`; return bindLogin($app); }
  const cat = await loadCatalog();
  $app.innerHTML = `<div class="loading">Loading…</div>`;
  await loadInv(true);
  const listed = new Map();
  const { data: mine } = await sb.from('listings').select('card_ref').eq('seller_id', state.user.id).in('status', ['active', 'reserved']);
  for (const l of mine || []) listed.set(l.card_ref, (listed.get(l.card_ref) || 0) + 1);

  const f = JSON.parse(sessionStorage.getItem('invf') || '{"q":"","set":"","sort":"value"}');
  const view = localStorage.getItem('view_inv') || 'list';

  const draw = () => {
    const st = invStats();
    let rows = st.rows.filter((r) => (!f.set || r.c.set === f.set) && (!f.q || (r.c.code + ' ' + r.c.name + ' ' + r.c.jp).toLowerCase().includes(f.q.toLowerCase())));
    const sorters = { value: (a, b) => b.v - a.v, code: (a, b) => a.c.code.localeCompare(b.c.code) || a.c.ref.localeCompare(b.c.ref), qty: (a, b) => b.q - a.q, name: (a, b) => a.c.name.localeCompare(b.c.name) };
    rows.sort(sorters[f.sort] || sorters.value);
    const sets = [...new Set(st.rows.map((r) => r.c.set))];
    $app.innerHTML = `<div class="head"><h1>Inventory</h1><div class="row tight"><button class="btn sec" id="share">🔗 Share</button><button class="btn sec" id="vm">${view === 'list' ? '▦ Grid' : '☰ List'}</button><button class="btn" id="add">+ Add card</button></div></div>
      <div class="hero small"><div class="muted">Value</div><div class="big-num">${bnd(st.value)}</div><div class="muted">${st.count} cards · ${st.unique} unique</div></div>
      <div class="panel"><div class="row"><input id="q" placeholder="Search your cards" value="${esc(f.q)}">
        <select id="set"><option value="">All sets</option>${sets.map((s) => `<option value="${s}" ${f.set === s ? 'selected' : ''}>${esc(s.toUpperCase() + ' · ' + setName(s))}</option>`).join('')}</select>
        <select id="sort">${[['value', 'Value'], ['code', 'Card code'], ['qty', 'Quantity'], ['name', 'Name']].map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select></div></div>
      ${!st.unique ? `<div class="panel center"><p>Your inventory is empty.</p><p class="muted">Add cards by search or scan them with your camera.</p><div class="row tight" style="justify-content:center"><button class="btn" id="add2">+ Add card</button><a class="btn sec" href="#/scan">Scan</a></div></div>` : ''}
      ${view === 'grid' ? `<div class="grid">${rows.map((r) => gridCell(r, listed)).join('')}</div>` : `<div class="panel nopad">${rows.map((r) => listRow(r, listed)).join('')}</div>`}
      ${rows.length < st.unique ? `<p class="muted">Showing ${rows.length} of ${st.unique} unique cards.</p>` : ''}`;
    bind();
  };

  const listRow = ({ c, q, v }, listed) => {
    const l = listed.get(c.ref) || 0;
    return `<div class="inv-row" data-ref="${esc(c.ref)}">
      <div class="img" data-act="zoom">${cardImg(c, 'sm')}</div>
      <div class="grow"><div><b>${esc(c.code)}</b> ${esc(c.rarity)} ${artShort(c) ? '<span class="badge">' + esc(artShort(c)) + '</span>' : ''} ${l ? `<span class="badge bn">${l} listed</span>` : ''}</div>
        <div class="muted nm">${esc(c.name)}</div><div class="muted">${c.jpy ? bnd(refBnd(c)) + ' ea · ' + bnd(v) : 'No price'}</div></div>
      <div class="stepper"><button data-act="dec">−</button><b>${q}</b><button data-act="inc">+</button></div>
      <button class="btn sec sm-btn" data-act="sell">Sell</button></div>`;
  };
  const gridCell = ({ c, q, v }, listed) => `<div class="tile" data-ref="${esc(c.ref)}"><div data-act="zoom">${cardImg(c)}</div><div class="b"><div class="code">${esc(c.code)} · ${esc(c.rarity)}</div><div class="nm">${esc(c.name)}</div>
    <div class="row tight between"><span class="price">${bnd(v)}</span><span class="stepper"><button data-act="dec">−</button><b>${q}</b><button data-act="inc">+</button></span></div>
    <button class="btn sec sm-btn" data-act="sell" style="width:100%;margin-top:.3rem">Sell</button></div></div>`;

  function bind() {
    const $ = (s) => $app.querySelector(s);
    const upd = () => { f.q = $('#q').value; f.set = $('#set').value; f.sort = $('#sort').value; sessionStorage.setItem('invf', JSON.stringify(f)); };
    $('#q').oninput = () => { upd(); clearTimeout(bind.t); bind.t = setTimeout(() => { draw(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
    $('#set').onchange = () => { upd(); draw(); }; $('#sort').onchange = () => { upd(); draw(); };
    $('#share').onclick = guard(() => openShareSheet(state.me?.display_name ? state.me.display_name + '’s' : 'my'));
    $('#vm').onclick = () => { localStorage.setItem('view_inv', view === 'list' ? 'grid' : 'list'); viewInventory($app); };
    const addCard = () => cardPicker(guard(async (c) => { await invAdjust(c.ref, 1); toast(`${c.code} added`); draw(); }), { title: 'Add to inventory' });
    $('#add').onclick = addCard; const a2 = $('#add2'); if (a2) a2.onclick = addCard;
    $app.querySelectorAll('[data-ref]').forEach((el) => {
      const ref = el.dataset.ref, c = cat.byRef.get(ref);
      el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = guard(async () => {
        const a = b.dataset.act;
        if (a === 'zoom') return enlarge(c);
        if (a === 'inc') { await invAdjust(ref, 1); draw(); }
        if (a === 'dec') {
          const q = state.inv.get(ref);
          if (q === 1 && !(await confirmSheet('Remove card?', `${c.code} ${c.name} will be removed from your inventory.`, 'Remove', true))) return;
          await invAdjust(ref, -1); draw();
        }
        if (a === 'sell') location.hash = '#/sell/' + ref;
      })));
    });
  }
  draw();
}
