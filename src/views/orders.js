import { sb, state, esc, bnd, toast, guard, rpc, loadCatalog, listingImg, listingPrice, timerHtml, needLogin, bindLogin, confirmSheet, rateSheet } from '../lib.js';
import { cardFilter } from './exploreSets.js';
import { shareChoice } from './shared.js';
import { fetchAll } from '../lib.js';
import { waUrl, receiptData, msgInformSeller, msgInformBuyer, downloadReceipt, priceDiff, finalPrice, fmtDelta, reportModel, reportCsv, reportPdf, downloadBlob, downloadText } from '../receipt.js';
import { soldSheet } from '../sold.js';

const stChip = (l, uid, role) => {
  const m = {
    active: l.type !== 'auction' ? ['Active', ''] : role === 'sell' ? [l.bid_count ? 'Active · bids' : 'Active', ''] : (l.current_bidder === uid ? ['Leading', 'ok'] : ['Outbid', 'bad']),
    reserved: ['Reserved: settle on WhatsApp', 'warn'], sold: ['Sold', 'ok'], ended: ['Ended', ''], cancelled: ['Cancelled', ''],
  };
  const [t, c] = m[l.status] || [l.status, ''];
  return `<span class="chip ${c}">${esc(t)}</span>`;
};

async function contactOf(l) {
  try { return (await rpc('get_contact', { p_listing: l.id }))?.[0] || null; } catch { return null; }
}

export async function viewOrders($app, opts = {}) {
  if (!state.user) { $app.innerHTML = `<h1>Orders</h1>${needLogin('see your orders')}`; return bindLogin($app); }
  await loadCatalog();
  const uid = state.user.id;
  const only = opts.only || null;                       // 'selling' = the My listings page
  const tab = only || (sessionStorage.getItem('otab') === 'sold' ? 'sold' : 'buying');
  $app.innerHTML = `<div class="head"><h1>${only ? 'My listings' : 'Orders'}</h1><div class="row tight"><div class="vsw" id="ovw"><button data-v="list" aria-label="List">☰</button><button data-v="grid" aria-label="Grid">▦</button><button data-v="tiles" aria-label="Tiles">▪▪▪</button></div><button class="btn sec" id="ofb">⚙ Filters</button><button class="btn sec" id="rf">↻</button></div></div>
    ${state.me?.strikes ? `<div class="notice err">You have ${state.me.strikes} strike(s). At 3 you are blocked from bidding, buying and listing.</div>` : ''}
 ${only ? '<p><a class="btn" href="#/sell">+ New listing</a></p>' : ''}
    <div class="seg" ${only ? 'style="display:none"' : ''}><a data-t="buying" class="${tab === 'buying' ? 'on' : ''}">Buying</a><a data-t="sold" class="${tab === 'sold' ? 'on' : ''}">Sold history</a></div>
    <div id="body"><div class="loading">Loading…</div></div>`;
  $app.querySelectorAll('.seg a').forEach((a) => (a.onclick = () => { sessionStorage.setItem('otab', a.dataset.t); viewOrders($app); }));
  $app.querySelector('#rf').onclick = () => viewOrders($app, opts);
  const body = $app.querySelector('#body');
  let ov = localStorage.getItem('view_ord') || 'list';
  const setOv = () => { body.className = 'ov-' + ov; $app.querySelectorAll('#ovw button').forEach((b) => b.classList.toggle('on', b.dataset.v === ov)); };
  $app.querySelectorAll('#ovw button').forEach((b) => (b.onclick = () => { ov = b.dataset.v; localStorage.setItem('view_ord', ov); setOv(); }));
  setOv();
  const sel = '*, seller:profiles!listings_seller_id_fkey(display_name), buyer:profiles!listings_buyer_id_fkey(display_name)';

  const LST = new Map();
  let myRated = new Set();   // sold deals I already rated
  try { myRated = new Set(((await sb.from('ratings').select('listing_id').eq('rater_id', uid).limit(2000)).data || []).map((r) => r.listing_id)); } catch {}
  const PER = { all: 'All time', month: 'This month', last: 'Last month', ytd: 'This year' };
  const inPeriod = (l, per) => {
    const d = new Date(l.sold_at || l.created_at), now = new Date(), y = now.getFullYear(), m = now.getMonth(), lm = new Date(y, m - 1, 1);
    if (per === 'month') return d.getFullYear() === y && d.getMonth() === m;
    if (per === 'last') return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
    if (per === 'ytd') return d.getFullYear() === y;
    return true;
  };
  const reportPanel = (role) => `<div class="panel rpt"><b>Order history report</b>
    <div class="row tight" style="margin:.4rem 0"><select id="rp-per">${Object.entries(PER).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn sec" data-rp="pdf" data-role="${role}">📄 Report (PDF)</button><button class="btn sec" data-rp="csv" data-role="${role}">📊 Excel (CSV)</button></div>
    <p class="muted">${role === 'sell' ? 'Completed sales' : 'Completed purchases'} for the period, with listing price, final price and the difference (BND and %). Orders still on hold are not included.</p></div>`;
  const card = async (l, role) => {
    LST.set(l.id, l);
    const c = state.cat.byRef.get(l.card_ref);
    const price = listingPrice(l);
    let extra = '', ct = null;
    if (l.status === 'reserved') {
      ct = await contactOf(l);
      const rd = receiptData(l, c?.name || l.card_name);
      extra += `<div class="notice">${l.type === 'auction' ? 'Auction won' : role === 'sell' ? 'On hold: a buyer clicked Buy now' : 'On hold for you'}. ${role === 'sell' ? 'Contact the buyer on WhatsApp. After the meet-up and payment, tap Sold.' : 'Tell the seller you want to buy it.'}
        ${ct ? `<br><a class="btn sm-btn" target="_blank" rel="noopener" href="${waUrl(ct.whatsapp, role === 'sell' ? `Hi ${ct.display_name}, thanks for buying ${rd.code} ${rd.name} (${rd.cond}). When and where can we meet?\nListing: ${rd.url}` : msgInformSeller(rd))}">💬 ${role === 'sell' ? 'WhatsApp buyer' : 'Inform seller on WhatsApp'}</a>` : ''}</div>`;
    }
    if (l.status === 'sold' && role === 'sell') {
      const ct = await contactOf(l);
      if (ct) extra += `<a class="btn sm-btn" target="_blank" rel="noopener" href="${waUrl(ct.whatsapp, msgInformBuyer(receiptData(l, c?.name || l.card_name)))}">💬 Inform buyer on WhatsApp</a> `;
    }
    const pd = l.status === 'sold' ? priceDiff(l) : null;
    const dcls = pd?.changed ? (role === 'buy' ? (pd.delta < 0 ? 'ok' : 'bad') : (pd.delta < 0 ? 'warn' : 'ok')) : '';
    const acts = [];
    if (role === 'sell' && l.status === 'reserved') acts.push(['sold', 'Sold', 'ok'], ['release', 'Release', 'sec'], ['noshow', 'Release + strike buyer', 'bad']);
    if (role === 'sell' && l.status === 'active' && l.bid_count === 0) { if (l._ids?.length > 1) acts.push(['unlistqty', 'Unlist', 'bad']); else acts.push(['cancel', 'Cancel listing', 'bad']); }
    if (role === 'buy' && l.status === 'reserved' && l.type === 'buy_now') acts.push(['unreserve', 'Cancel reservation', 'sec']);
    if (l.status === 'sold') acts.push(['receipt', '📄 Receipt (PDF)', 'sec']);
    if (l.status === 'sold' && l.buyer_id) acts.push(myRated.has(l.id) ? ['rated', '✔ Rated', 'sec'] : ['rate', `⭐ Rate ${role === 'sell' ? 'buyer' : 'seller'}`, '']);
    return `<div class="order" data-id="${l.id}"><a href="#/listing/${l.id}" class="oimg"><img src="${esc(listingImg(l))}" alt="" onerror="this.style.visibility='hidden'"></a>
      <div class="grow"><div class="row tight between"><b>${esc(l.card_code)} ${esc(l.rarity || '')}</b>${l._ids?.length > 1 ? ` <span class="qtag s">×${l._ids.length}</span>` : ''}${stChip(l, uid, role)}</div>
        <div class="muted nm">${esc(c?.name || l.card_name)} · ${esc(l.condition)}</div>
        <div><span class="price">${bnd(pd ? pd.final : price)}</span> <span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span>
          ${l.type === 'auction' && l.status === 'active' ? ` · ${l.bid_count} bids · ${timerHtml(l.ends_at)}` : ''}</div>
        ${pd ? (pd.changed ? `<div class="row tight" style="margin:.2rem 0"><span class="chip ${dcls}">${esc(fmtDelta(pd))} from listing price</span><span class="muted">Listing price ${bnd(pd.listing)}</span></div>` : '<div class="muted">Sold at the listing price</div>') : ''}
        <div class="muted">${role === 'sell' ? (l.buyer ? 'Buyer: ' + esc(l.buyer.display_name) : '') : 'Seller: ' + esc(l.seller?.display_name)} · ${l.status === 'sold' && l.sold_at ? 'Sold ' : ''}${new Date((l.status === 'sold' && l.sold_at) || l.created_at).toLocaleDateString()}</div>
        ${extra}<div class="ubar">${role === 'sell' && l.status === 'active' && l.type === 'buy_now' ? `<label class="usel"><input type="checkbox" data-sel="${(l._ids || [l.id]).join(',')}"> Select</label>` : ''}${l._ids?.length > 1 && l.status === 'active' ? `<input class="uqty" type="number" inputmode="numeric" min="1" max="${l._ids.length}" placeholder="Qty" title="Quantity to unlist (max ${l._ids.length}). Leave empty to unlist all ${l._ids.length}." aria-label="Quantity to unlist, max ${l._ids.length}" data-uq="${l.id}">` : ''}${acts.map(([k, t, cls]) => `<button class="btn sm-btn ${cls}" data-act="${k}">${t}</button>`).join('')}</div></div></div>`;
  };
  const wire = (reload) => body.querySelectorAll('.order').forEach((el) => {
    const id = el.dataset.id;
    el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = guard(async () => {
      const a = b.dataset.act;
      if (a === 'sold') { const r = await soldSheet(LST.get(id)); if (!r) return; await rpc('mark_sold', { p_listing: id, p_agreed_price: r.price }); }
      if (a === 'rated') return;
      if (a === 'rate') { if (await rateSheet(id, LST.get(id).seller_id === uid ? 'buyer' : 'seller')) { myRated.add(id); reload(); } return; }
      if (a === 'receipt') { const { data: row } = await sb.from('listings').select(sel).eq('id', id).single(); downloadReceipt(receiptData(row, state.cat.byRef.get(row.card_ref)?.name || row.card_name)); return; }
      if (a === 'release') await rpc('seller_release', { p_listing: id, p_no_show: false });
      if (a === 'noshow') { if (!(await confirmSheet('Strike the buyer?', 'The buyer gets a strike for not completing the deal. At 3 strikes they are blocked.', 'Release + strike', true))) return; await rpc('seller_release', { p_listing: id, p_no_show: true }); }
      if (a === 'unlistqty') { const all = LST.get(id)._ids || [id]; const inp = $app.querySelector(`input[data-uq="${id}"]`); const raw = (inp?.value || '').trim(); let q = raw === '' ? all.length : Math.floor(Number(raw)); if (!(q >= 1)) { toast('Enter a quantity of 1 or more'); return; } if (q > all.length) { toast(`Only ${all.length} listed`); return; } if (!(await confirmSheet(`Unlist ${q}?`, q === all.length ? `All ${q} identical listings will be removed from the Marketplace.` : `${q} of ${all.length} identical listings will be removed; ${all.length - q} stay on sale. Your collection is not changed.`, `Unlist ${q}`, true))) return; const n = await rpc('cancel_my_listings', { p_ids: all.slice(0, q) }); toast(`${n} unlisted`); reload(); return; }
      if (a === 'cancel') { if (!(await confirmSheet('Cancel listing?', 'The listing will be removed.', 'Cancel listing', true))) return; await rpc('cancel_listing', { p_listing: id }); }
      if (a === 'unreserve') await rpc('cancel_reservation', { p_listing: id });
      toast('Done'); reload();
    })));
  });

  if (tab === 'buying') {
    const [won, bids] = await Promise.all([
      sb.from('listings').select(sel).eq('buyer_id', uid).order('created_at', { ascending: false }).limit(60),
      sb.from('bids').select('listing_id, listings!inner(' + sel + ')').eq('bidder_id', uid).eq('listings.status', 'active').order('created_at', { ascending: false }).limit(60),
    ]);
    const seen = new Set(), bidding = [];
    for (const b of bids.data || []) if (!seen.has(b.listing_id)) { seen.add(b.listing_id); bidding.push(b.listings); }
    const wonRows = won.data || [];
    body.innerHTML = `<h2>Active bids</h2>${bidding.length ? (await Promise.all(bidding.map((l) => card(l, 'buy')))).join('') : '<p class="muted">No active bids. <a href="#/market?type=auction">Browse auctions</a></p>'}
      <h2 style="margin-top:1.2rem">Purchases and won auctions</h2>${reportPanel('buy')}${wonRows.length ? (await Promise.all(wonRows.map((l) => card(l, 'buy')))).join('') : '<p class="muted">Nothing yet. <a href="#/market">Browse listings</a></p>'}`;
  } else if (tab === 'selling') {
    const [live, past] = await Promise.all([
      fetchAll(() => sb.from('listings').select(sel).eq('seller_id', uid).in('status', ['active', 'reserved']).order('created_at', { ascending: false }).order('id')),
      sb.from('listings').select(sel).eq('seller_id', uid).in('status', ['ended', 'cancelled']).order('created_at', { ascending: false }).limit(15),
    ]);
    const data = [...live, ...(past.data || []).filter((l) => l.status === 'ended' || l.status === 'cancelled')];
    const g = (s) => (data || []).filter((l) => s.includes(l.status));
    // identical active Buy now listings (same card, condition, language, price) become one card with a quantity
    const combine = (arr) => { const m = new Map(), out = []; for (const l of arr) { if (l.type !== 'buy_now' || l.status !== 'active') { out.push(l); continue; } const k = [l.card_ref, l.condition, l.language, l.price].join('|'); const g = m.get(k); if (g) g._ids.push(l.id); else { const r = { ...l, _ids: [l.id] }; m.set(k, r); out.push(r); } } return out; };
    const sect = async (t, arr, empty) => `<h2>${t}</h2>${arr.length ? (await Promise.all(combine(arr).map((l) => card(l, 'sell')))).join('') : `<p class="muted">${empty}</p>`}`;
    body.innerHTML = `${only ? '' : '<p><a class="btn" href="#/sell">+ New listing</a></p>'}${await sect('Needs settlement', g(['reserved']), 'None.')}<div style="height:.8rem"></div>${g(['active']).some((l) => l.type === 'buy_now') ? '<div class="unl" id="unl"><button class="btn sec sm-btn" id="unsel" disabled>Unlist selected (0)</button><button class="btn sec sm-btn" id="unpick">Select all</button><button class="btn bad sm-btn" id="unall">Unlist all</button><button class="btn sm-btn" id="unshare">Share</button></div>' : ''}${await sect('Active listings', g(['active']), 'No active listings.')}<div style="height:.8rem"></div>${await sect('Ended and cancelled', g(['ended', 'cancelled']).slice(0, 15), 'None.')}`;
  } else {
    const { data } = await sb.from('listings').select(sel).eq('seller_id', uid).eq('status', 'sold').order('created_at', { ascending: false }).limit(200);
    const rows = data || [], total = rows.reduce((a, l) => a + finalPrice(l), 0), listed = rows.reduce((a, l) => a + listingPrice(l), 0), net = Math.round((total - listed) * 100) / 100;
    const month = new Date().toISOString().slice(0, 7);
    const thisM = rows.filter((l) => (l.sold_at || l.created_at).startsWith(month)).reduce((a, l) => a + finalPrice(l), 0);
    body.innerHTML = `<div class="stats"><div class="stat"><b>${rows.length}</b><span>Sold</span></div><div class="stat"><b>${bnd(total)}</b><span>Total sales</span></div><div class="stat"><b>${bnd(thisM)}</b><span>This month</span></div><div class="stat"><b>${net === 0 ? 'At listing' : (net < 0 ? '- ' : '+ ') + bnd(Math.abs(net)) + ' (' + (net < 0 ? '-' : '+') + Math.abs(listed ? (net / listed) * 100 : 0).toFixed(1) + '%)'}</b><span>vs listing prices</span></div></div>
      ${reportPanel('sell')}
      <input id="sq" placeholder="Search sold cards or buyer" style="margin:.6rem 0">
      <div id="sl">${(await Promise.all(rows.map((l) => card(l, 'sell')))).join('') || '<p class="muted">Nothing sold yet. Sales appear here after you tap "Sold".</p>'}</div>`;
    body.querySelector('#sq').oninput = (e) => { const t = e.target.value.toLowerCase(); body.querySelectorAll('.order').forEach((o) => (o.style.display = o.textContent.toLowerCase().includes(t) ? '' : 'none')); };
  }
  wire(() => viewOrders($app, opts));
  {
    const boxes = () => [...body.querySelectorAll('input[data-sel]')];
    const qtyOf = (b) => { const ids = b.dataset.sel.split(','); const inp = $app.querySelector(`input[data-uq="${ids[0]}"]`); const v = Math.floor(Number(inp?.value)); return v >= 1 ? Math.min(v, ids.length) : 1; };
    const picked = () => boxes().filter((b) => b.checked).flatMap((b) => b.dataset.sel.split(',').slice(0, qtyOf(b)));
    const upd = () => { const s = $app.querySelector('#unsel'); if (!s) return; const n = picked().length; s.textContent = `Unlist selected (${n})`; s.disabled = !n; s.className = 'btn sm-btn ' + (n ? 'bad' : 'sec'); const p = $app.querySelector('#unpick'); p.textContent = boxes().length && boxes().every((b) => b.checked) ? 'Clear' : 'Select all'; };
    boxes().forEach((b) => (b.onchange = upd));
    $app.querySelectorAll('input[data-uq]').forEach((i) => (i.oninput = upd));
    const run = guard(async (ids, label) => { const n = await rpc('cancel_my_listings', { p_ids: ids }); toast(`${n} listing${n === 1 ? '' : 's'} unlisted`); viewOrders($app, opts); });
    const un = $app.querySelector('#unl');
    if (un) {
      $app.querySelector('#unshare').onclick = () => {
        const base = `${location.origin}${location.pathname}#/`;
        const grp = (b) => { const ids = b.dataset.sel.split(','); return { ids, l: LST.get(ids[0]) }; };
        shareChoice({ title: 'Share my listings', selCount: boxes().filter((b) => b.checked).length, build: async (kind) => {
          const gs = boxes().filter((b) => kind === 'all' || b.checked).map(grp);
          const lines = gs.slice(0, 15).map(({ ids, l }) => `• ${l.card_code} ${l.rarity || ''} ${l.card_name || ''} ×${ids.length} · BND ${Number(l.price).toFixed(2)}\n  ${base}listing/${ids[0]}`);
          return `My One Piece cards for sale on Brunei One Piece TCG (${gs.length} card${gs.length === 1 ? '' : 's'}):\n${lines.join('\n')}${gs.length > 15 ? `\n…and ${gs.length - 15} more` : ''}\n\nAll my listings: ${base}user/${uid}`;
        } });
      };
      $app.querySelector('#unpick').onclick = () => { const all = boxes().every((b) => b.checked); boxes().forEach((b) => (b.checked = !all)); upd(); };
      $app.querySelector('#unsel').onclick = guard(async () => { const ids = picked(); if (!ids.length) return; if (!(await confirmSheet(`Unlist ${ids.length}?`, `${ids.length} listing${ids.length === 1 ? '' : 's'} will be removed from the Marketplace. Your collection is not changed.`, `Unlist ${ids.length}`, true))) return; await run(ids); });
      $app.querySelector('#unall').onclick = guard(async () => { const n = boxes().flatMap((b) => b.dataset.sel.split(',')).length; if (!(await confirmSheet('Unlist everything?', `All ${n} of your active Buy now listings will be removed from the Marketplace. Your collection is not changed. Auctions with bids are not affected.`, 'Unlist all', true))) return; await run(null); });
    }
  }
  // Filters: hide the cards whose listing does not match (same sheet as Explore)
  const cf = cardFilter('ofx', state.cat, () => applyF());
  const refsOnPage = () => new Set([...body.querySelectorAll('.order')].map((o) => LST.get(o.dataset.id)?.card_ref).filter(Boolean));
  const applyF = () => {
    const ok = cf.on() ? cf.pass(refsOnPage()) : null;
    body.querySelectorAll('.order').forEach((o) => o.classList.toggle('fhide', !!ok && !ok.has(LST.get(o.dataset.id)?.card_ref)));
    const b = $app.querySelector('#ofb'); b.textContent = cf.label(); b.className = 'btn ' + (cf.on() ? '' : 'sec');
    let n = body.querySelector('.fnone'); const shown = body.querySelectorAll('.order:not(.fhide)').length;
    if (ok && !shown) { if (!n) { n = document.createElement('p'); n.className = 'muted fnone'; n.textContent = 'Nothing matches these filters.'; body.prepend(n); } } else n?.remove();
  };
  $app.querySelector('#ofb').onclick = () => cf.open(() => { const ok = cf.pass(refsOnPage()); return [...body.querySelectorAll('.order')].filter((o) => !cf.on() || ok.has(LST.get(o.dataset.id)?.card_ref)).length; });
  await cf.ensure(); applyF();
  body.querySelectorAll('[data-rp]').forEach((b) => (b.onclick = guard(async () => {
    const role = b.dataset.role, per = body.querySelector('#rp-per').value;
    const { data } = await sb.from('listings').select(sel).eq(role === 'sell' ? 'seller_id' : 'buyer_id', uid).eq('status', 'sold').limit(2000);
    const rows = (data || []).filter((l) => inPeriod(l, per));
    if (!rows.length) { toast('No completed orders in this period', true); return; }
    const m = reportModel(rows, role, (l) => state.cat.byRef.get(l.card_ref)?.name || l.card_name);
    const meta = { title: role === 'sell' ? 'Sales history report' : 'Purchase history report', period: PER[per], who: state.me?.display_name || '' };
    const file = `${role === 'sell' ? 'Sales' : 'Purchases'}-${per}-${new Date().toISOString().slice(0, 10)}`;
    if (b.dataset.rp === 'csv') downloadText(`${file}.csv`, reportCsv(m)); else downloadBlob(`${file}.pdf`, reportPdf(m, meta));
    toast(`Report ready: ${m.sum.n} order${m.sum.n > 1 ? 's' : ''}`);
  })));
}

