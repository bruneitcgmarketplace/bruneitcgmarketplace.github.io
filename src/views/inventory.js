import { catImg, fetchAll, rpc, sheet, sb, state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, invStats, refBnd, cardImg, setName, cardPicker, needLogin, bindLogin, enlarge, confirmSheet, artShort } from '../lib.js';
import { openShareSheet, shareChoice, shareUrl } from './shared.js';
import { openListAll } from './listall.js';
import { cardFilter } from './exploreSets.js';

export async function viewInventory($app) {
  if (!state.user) { $app.innerHTML = `<h1>Inventory</h1>${needLogin('track your collection')}`; return bindLogin($app); }
  const cat = await loadCatalog();
  $app.innerHTML = `<div class="loading">Loading…</div>`;
  await loadInv(true);
  const listed = new Map();
  const mine = await fetchAll(() => sb.from('listings').select('card_ref').eq('seller_id', state.user.id).in('status', ['active', 'reserved']).order('id'));
  for (const l of mine || []) listed.set(l.card_ref, (listed.get(l.card_ref) || 0) + 1);

  const f = JSON.parse(sessionStorage.getItem('invf') || '{"q":"","set":"","sort":"new"}');
  const view = localStorage.getItem('view_inv') || 'list';
  const cf = cardFilter('ivfx', cat, () => draw());
  const sel = new Set(); let shown = [];   // ticked cards, and the refs on screen
  const updSel = () => {
    const b = $app.querySelector('#listsel'); if (!b) return;
    b.textContent = `🏷 Selected (${sel.size})`; b.disabled = !sel.size; b.className = 'btn' + (sel.size ? '' : ' sec');
    const s = $app.querySelector('#selall'); if (s) s.textContent = shown.length && shown.every((r) => sel.has(r)) ? 'Clear' : 'Select all';
  };

  const draw = () => {
    const st = invStats();
    let rows = st.rows.filter((r) => (!f.set || r.c.set === f.set) && (!f.q || (r.c.code + ' ' + r.c.name + ' ' + r.c.jp).toLowerCase().includes(f.q.toLowerCase())));
    const sorters = { new: (a, b) => b.t - a.t || a.c.code.localeCompare(b.c.code), value: (a, b) => b.v - a.v, code: (a, b) => a.c.code.localeCompare(b.c.code) || a.c.ref.localeCompare(b.c.ref), qty: (a, b) => b.q - a.q, name: (a, b) => a.c.name.localeCompare(b.c.name) };
    if (cf.on()) { const okf = cf.pass(new Set(rows.map((r) => r.c.ref))); rows = rows.filter((r) => okf.has(r.c.ref)); }
    rows.sort(sorters[f.sort] || sorters.value);
    shown = rows.map((r) => r.c.ref);
    { const have = new Set(st.rows.map((r) => r.c.ref)); for (const r of [...sel]) if (!have.has(r)) sel.delete(r); }
    const sets = [...new Set(st.rows.map((r) => r.c.set))];
    $app.innerHTML = `<div class="head"><h1>Inventory</h1><div class="row tight"><button class="btn sec" id="share">🔗 Share</button><button class="btn sec" id="vm">${view === 'list' ? '▦ Grid' : '☰ List'}</button><button class="btn" id="add">+ Add card</button><a class="btn sec" href="#/scan">📷 Scan</a></div></div>
      <div class="hero small"><div class="muted">Value</div><div class="big-num">${bnd(st.value)}</div><div class="muted">${st.count} cards · ${st.unique} unique</div></div>
      ${st.unique ? '<div class="invact"><button class="btn" id="listall">🏷 List all</button><button class="btn sec" id="listsel" disabled>🏷 Selected (0)</button><button class="btn sec" id="selall">Select all</button><button class="btn sec" id="invf"></button></div>' : ''}
      <div class="panel"><div class="row"><input id="q" placeholder="Search your cards" value="${esc(f.q)}">
        <select id="set"><option value="">All sets</option>${sets.map((s) => `<option value="${s}" ${f.set === s ? 'selected' : ''}>${esc(s.toUpperCase() + ' · ' + setName(s))}</option>`).join('')}</select>
        <select id="sort">${[['new', 'Newest added'], ['value', 'Value'], ['code', 'Card code'], ['qty', 'Quantity'], ['name', 'Name']].map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select></div></div>
      ${!st.unique ? `<div class="panel center"><p>Your inventory is empty.</p><p class="muted">Add cards by search or scan them with your camera.</p><div class="row tight" style="justify-content:center"><button class="btn" id="add2">+ Add card</button><a class="btn sec" href="#/scan">Scan</a></div></div>` : ''}
      ${view !== 'list' ? `<div class="grid${view === 'tiles' ? ' tiles' : ''}">${rows.map((r) => gridCell(r, listed)).join('')}</div>` : `<div class="panel nopad">${rows.map((r) => listRow(r, listed)).join('')}</div>`}
      ${rows.length < st.unique ? `<p class="muted">Showing ${rows.length} of ${st.unique} unique cards.</p>` : ''}`;
    bind(); updSel();
  };

  const listRow = ({ c, q, v }, listed) => {
    const l = listed.get(c.ref) || 0;
    return `<div class="inv-row" data-ref="${esc(c.ref)}">
      <input type="checkbox" data-act="pick" aria-label="Select ${esc(c.code)}" ${sel.has(c.ref) ? 'checked' : ''} style="width:1.4rem;height:1.4rem;flex:none;margin:0 .45rem 0 0">
      <div class="img" data-act="zoom">${cardImg(c, 'sm')}</div>
      <div class="grow"><div><b>${esc(c.code)}</b> ${esc(c.rarity)} ${artShort(c) ? '<span class="badge">' + esc(artShort(c)) + '</span>' : ''} ${l ? `<button class="badge bn lbtn" data-act="unlist" title="Unlist">${l} listed ✕</button>` : ''}</div>
        <div class="muted nm">${esc(c.name)}</div><div class="muted">${c.jpy ? bnd(refBnd(c)) + ' ea · ' + bnd(v) : 'No price'}</div></div>
      <div class="ctl"><div class="stepper"><button data-act="dec">−</button><b>${q}</b><button data-act="inc">+</button></div>
      <button class="btn sec sm-btn" data-act="sell">Sell</button></div></div>`;
  };
  const gridCell = ({ c, q, v }, listed) => `<div class="tile" data-ref="${esc(c.ref)}"><div data-act="zoom">${cardImg(c)}</div><div class="b"><div class="code"><input type="checkbox" data-act="pick" aria-label="Select ${esc(c.code)}" ${sel.has(c.ref) ? 'checked' : ''} style="width:1.1rem;height:1.1rem;margin:0 .3rem 0 0;vertical-align:middle">${esc(c.code)} · ${esc(c.rarity)}</div><div class="nm">${esc(c.name)}</div>
    <div class="row tight between"><span class="price">${bnd(v)}</span><span class="stepper"><button data-act="dec">−</button><b>${q}</b><button data-act="inc">+</button></span></div>
    <button class="btn sec sm-btn" data-act="sell" style="width:100%;margin-top:.3rem">Sell</button></div></div>`;

  function bind() {
    const $ = (s) => $app.querySelector(s);
    const upd = () => { f.q = $('#q').value; f.set = $('#set').value; f.sort = $('#sort').value; sessionStorage.setItem('invf', JSON.stringify(f)); };
    $('#q').oninput = () => { upd(); clearTimeout(bind.t); bind.t = setTimeout(() => { draw(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
    $('#set').onchange = () => { upd(); draw(); }; $('#sort').onchange = () => { upd(); draw(); };
    const ifb = $('#invf'); if (ifb) { ifb.textContent = cf.label(); ifb.className = 'btn ' + (cf.on() ? '' : 'sec'); }
    if (ifb) ifb.onclick = () => cf.open(() => { const all = invStats().rows; const ok = cf.pass(new Set(all.map((r) => r.c.ref))); return all.filter((r) => !cf.on() || ok.has(r.c.ref)).length; });
    const la = $('#listall'); if (la) la.onclick = guard(() => openListAll());
    const ls = $('#listsel'); if (ls) ls.onclick = guard(() => openListAll([...sel]));
    const sa = $('#selall'); if (sa) sa.onclick = () => { if (shown.length && shown.every((r) => sel.has(r))) shown.forEach((r) => sel.delete(r)); else shown.forEach((r) => sel.add(r)); draw(); };
    $('#share').onclick = () => {
      const who = state.me?.display_name ? state.me.display_name + '’s' : 'my';
      const link = async () => { let { data: tk, error } = await sb.rpc('my_inventory_share'); if (error) throw new Error(error.message); if (!tk) { const r = await sb.rpc('share_inventory'); if (r.error) throw new Error(r.error.message); tk = r.data; } return shareUrl(tk); };
      const s = shareChoice({ title: 'Share my collection', selCount: sel.size, extra: '<p style="margin-top:.8rem"><button class="btn sec" id="sc-manage">Manage link / stop sharing</button></p>', build: async (kind) => {
        const url = await link();
        const rows = invStats().rows.filter((r) => kind === 'all' || sel.has(r.c.ref)).sort((a, b) => a.c.code.localeCompare(b.c.code) || a.c.ref.localeCompare(b.c.ref));
        const pics = rows.map((r) => ({ url: catImg(r.c, '200_280'), tag: r.q > 1 ? `×${r.q}` : '' })), sub = `${rows.length} unique · ${rows.reduce((s, r) => s + r.q, 0)} cards`;
        if (kind === 'all') return { text: `Check out ${who} One Piece card collection on Brunei One Piece TCG: ${url}`, pics, sub };
        const lines = rows.slice(0, 40).map((r) => `• ${r.c.code} ${r.c.rarity} ${r.c.name} ×${r.q}`);
        return { text: `${who} One Piece cards (${rows.length} selected):\n${lines.join('\n')}${rows.length > 40 ? `\n…and ${rows.length - 40} more` : ''}\n\nFull collection: ${url}`, pics, sub };
      } });
      s.el.querySelector('#sc-manage').onclick = () => { s.close(); guard(() => openShareSheet(who))(); };
    };
    $('#vm').onclick = () => { localStorage.setItem('view_inv', { list: 'grid', grid: 'tiles', tiles: 'list' }[view] || 'list'); viewInventory($app); };
    const addCard = () => cardPicker(guard(async (c) => { await invAdjust(c.ref, 1); toast(`${c.code} added`); draw(); }), { title: 'Add to inventory' });
    $('#add').onclick = addCard; const a2 = $('#add2'); if (a2) a2.onclick = addCard;
    $app.querySelectorAll('[data-ref]').forEach((el) => {
      const ref = el.dataset.ref, c = cat.byRef.get(ref);
      el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = guard(async () => {
        const a = b.dataset.act;
        if (a === 'pick') { if (b.checked) sel.add(ref); else sel.delete(ref); return updSel(); }
        if (a === 'zoom') return enlarge(c);
        if (a === 'inc') { await invAdjust(ref, 1); draw(); }
        if (a === 'dec') {
          const q = state.inv.get(ref);
          if (q === 1 && !(await confirmSheet('Remove card?', `${c.code} ${c.name} will be removed from your inventory.`, 'Remove', true))) return;
          await invAdjust(ref, -1); draw();
        }
        if (a === 'sell') location.hash = '#/sell/' + ref;
        if (a === 'unlist') {
          const ids = (await fetchAll(() => sb.from('listings').select('id').eq('seller_id', state.user.id).eq('card_ref', ref).eq('type', 'buy_now').eq('status', 'active').order('created_at').order('id'))).map((x) => x.id);
          if (!ids.length) { toast('Nothing to unlist'); return viewInventory($app); }
          const sh = sheet(`<h2>Unlist ${esc(c.code)}</h2><p class="muted">${ids.length} listed on the Marketplace. Enter how many to unlist, or leave empty to unlist all.</p><input type="number" inputmode="numeric" min="1" max="${ids.length}" id="uqn" placeholder="Qty (max ${ids.length})"><div class="row tight" style="margin-top:.6rem"><button class="btn bad" id="uqgo">Unlist</button></div>`);
          sh.el.querySelector('#uqgo').onclick = guard(async () => {
            const raw = sh.el.querySelector('#uqn').value.trim(); const q = raw === '' ? ids.length : Math.floor(Number(raw));
            if (!(q >= 1) || q > ids.length) { toast(`Enter 1 to ${ids.length}`); return; }
            const n = await rpc('cancel_my_listings', { p_ids: ids.slice(0, q) }); sh.close(); toast(`${n} unlisted`); viewInventory($app);
          });
        }
      })));
    });
  }
  await cf.ensure();
  draw();
}
