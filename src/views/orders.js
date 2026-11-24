import { sb, state, esc, bnd, toast, guard, rpc, loadCatalog, listingImg, listingPrice, timerHtml, needLogin, bindLogin, confirmSheet } from '../lib.js';
import { waUrl, receiptData, msgInformSeller, msgInformBuyer, downloadReceipt } from '../receipt.js';

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
  const tab = only || sessionStorage.getItem('otab') || 'buying';
  $app.innerHTML = `<div class="head"><h1>${only ? 'My listings' : 'Orders'}</h1><button class="btn sec" id="rf">↻</button></div>
    ${state.me?.strikes ? `<div class="notice err">You have ${state.me.strikes} strike(s). At 3 you are blocked from bidding, buying and listing.</div>` : ''}
 ${only ? '<p><a class="btn" href="#/sell">+ New listing</a> <a class="btn sec" href="#/orders">Sold history</a></p>' : ''}
    <div class="seg" ${only ? 'style="display:none"' : ''}><a data-t="buying" class="${tab === 'buying' ? 'on' : ''}">Buying</a><a data-t="selling" class="${tab === 'selling' ? 'on' : ''}">Selling</a><a data-t="sold" class="${tab === 'sold' ? 'on' : ''}">Sold history</a></div>
    <div id="body"><div class="loading">Loading…</div></div>`;
  $app.querySelectorAll('.seg a').forEach((a) => (a.onclick = () => { sessionStorage.setItem('otab', a.dataset.t); viewOrders($app); }));
  $app.querySelector('#rf').onclick = () => viewOrders($app, opts);
  const body = $app.querySelector('#body');
  const sel = '*, seller:profiles!listings_seller_id_fkey(display_name), buyer:profiles!listings_buyer_id_fkey(display_name)';

  const card = async (l, role) => {
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
    const acts = [];
    if (role === 'sell' && l.status === 'reserved') acts.push(['sold', 'Sold', 'ok'], ['release', 'Release', 'sec'], ['noshow', 'Release + strike buyer', 'bad']);
    if (role === 'sell' && l.status === 'active' && l.bid_count === 0) acts.push(['cancel', 'Cancel listing', 'bad']);
    if (role === 'buy' && l.status === 'reserved' && l.type === 'buy_now') acts.push(['unreserve', 'Cancel reservation', 'sec']);
    if (l.status === 'sold') acts.push(['receipt', '📄 Receipt (PDF)', 'sec']);
    return `<div class="order" data-id="${l.id}"><a href="#/listing/${l.id}" class="oimg"><img src="${esc(listingImg(l))}" alt="" onerror="this.style.visibility='hidden'"></a>
      <div class="grow"><div class="row tight between"><b>${esc(l.card_code)} ${esc(l.rarity || '')}</b>${stChip(l, uid, role)}</div>
        <div class="muted nm">${esc(c?.name || l.card_name)} · ${esc(l.condition)}</div>
        <div><span class="price">${bnd(price)}</span> <span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span>
          ${l.type === 'auction' && l.status === 'active' ? ` · ${l.bid_count} bids · ${timerHtml(l.ends_at)}` : ''}</div>
        <div class="muted">${role === 'sell' ? (l.buyer ? 'Buyer: ' + esc(l.buyer.display_name) : '') : 'Seller: ' + esc(l.seller?.display_name)} · ${new Date(l.created_at).toLocaleDateString()}</div>
        ${extra}<div class="row tight">${acts.map(([k, t, cls]) => `<button class="btn ${cls}" data-act="${k}">${t}</button>`).join('')}</div></div></div>`;
  };
  const wire = (reload) => body.querySelectorAll('.order').forEach((el) => {
    const id = el.dataset.id;
    el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = guard(async () => {
      const a = b.dataset.act;
      if (a === 'sold') { if (!(await confirmSheet('Mark this card as sold?', 'Confirm you have met the buyer and been paid. This completes the deal.', 'Sold'))) return; await rpc('mark_sold', { p_listing: id }); }
      if (a === 'receipt') { const { data: row } = await sb.from('listings').select(sel).eq('id', id).single(); downloadReceipt(receiptData(row, state.cat.byRef.get(row.card_ref)?.name || row.card_name)); return; }
      if (a === 'release') await rpc('seller_release', { p_listing: id, p_no_show: false });
      if (a === 'noshow') { if (!(await confirmSheet('Strike the buyer?', 'The buyer gets a strike for not completing the deal. At 3 strikes they are blocked.', 'Release + strike', true))) return; await rpc('seller_release', { p_listing: id, p_no_show: true }); }
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
      <h2 style="margin-top:1.2rem">Purchases and won auctions</h2>${wonRows.length ? (await Promise.all(wonRows.map((l) => card(l, 'buy')))).join('') : '<p class="muted">Nothing yet. <a href="#/market">Browse listings</a></p>'}`;
  } else if (tab === 'selling') {
    const { data } = await sb.from('listings').select(sel).eq('seller_id', uid).in('status', ['active', 'reserved', 'ended', 'cancelled']).order('created_at', { ascending: false }).limit(80);
    const g = (s) => (data || []).filter((l) => s.includes(l.status));
    const sect = async (t, arr, empty) => `<h2>${t}</h2>${arr.length ? (await Promise.all(arr.map((l) => card(l, 'sell')))).join('') : `<p class="muted">${empty}</p>`}`;
    body.innerHTML = `${only ? '' : '<p><a class="btn" href="#/sell">+ New listing</a></p>'}${await sect('Needs settlement', g(['reserved']), 'None.')}<div style="height:.8rem"></div>${await sect('Active listings', g(['active']), 'No active listings.')}<div style="height:.8rem"></div>${await sect('Ended and cancelled', g(['ended', 'cancelled']).slice(0, 15), 'None.')}`;
  } else {
    const { data } = await sb.from('listings').select(sel).eq('seller_id', uid).eq('status', 'sold').order('created_at', { ascending: false }).limit(200);
    const rows = data || [], total = rows.reduce((a, l) => a + listingPrice(l), 0);
    const month = new Date().toISOString().slice(0, 7);
    const thisM = rows.filter((l) => l.created_at.startsWith(month)).reduce((a, l) => a + listingPrice(l), 0);
    body.innerHTML = `<div class="stats"><div class="stat"><b>${rows.length}</b><span>Sold</span></div><div class="stat"><b>${bnd(total)}</b><span>Total sales</span></div><div class="stat"><b>${bnd(thisM)}</b><span>This month (by listing date)</span></div></div>
      <input id="sq" placeholder="Search sold cards or buyer" style="margin:.6rem 0">
      <div id="sl">${(await Promise.all(rows.map((l) => card(l, 'sell')))).join('') || '<p class="muted">Nothing sold yet. Sales appear here after you tap "Sold".</p>'}</div>`;
    body.querySelector('#sq').oninput = (e) => { const t = e.target.value.toLowerCase(); body.querySelectorAll('.order').forEach((o) => (o.style.display = o.textContent.toLowerCase().includes(t) ? '' : 'none')); };
  }
  wire(() => viewOrders($app, opts));
}
