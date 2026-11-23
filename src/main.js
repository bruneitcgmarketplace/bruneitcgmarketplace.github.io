import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const BANK = import.meta.env.VITE_BANK_DETAILS || 'Bank details not set yet (set VITE_BANK_DETAILS)';
const PRICE = import.meta.env.VITE_MEMBER_PRICE || '5';
const configured = !!(URL_ && KEY);
const sb = configured ? createClient(URL_, KEY) : null;

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const state = { user: null, me: null, catalog: null };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bnd = (n) => 'BND ' + Number(n).toFixed(2);
const imgOf = (l) => l.photos?.[0] || l.catalog_image || '';
const catImg = (c) => `https://card.yuyu-tei.jp/opc/200_280/${c[1]}/${c[0]}.jpg`;
const isMember = () => state.me && state.me.member_until && new Date(state.me.member_until) > new Date();
let toastT;
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'on' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), 3500);
}
const rpc = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};
function guard(fn) {
  return async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || String(e), true); } };
}
function fmtLeft(ms) {
  if (ms <= 0) return 'Ended';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${s % 60}s` : `${m}m ${s % 60}s`;
}
const timerHtml = (iso) => `<span class="timer" data-end="${esc(iso)}"></span>`;
setInterval(() => {
  document.querySelectorAll('.timer[data-end]').forEach((el) => {
    const ms = new Date(el.dataset.end) - Date.now();
    el.textContent = fmtLeft(ms);
    el.classList.toggle('soon', ms > 0 && ms < 3600e3);
    if (ms <= 0 && el.dataset.fired !== '1' && el.dataset.reload) { el.dataset.fired = '1'; setTimeout(route, 1500); }
  });
}, 1000);

async function loadCatalog() {
  if (!state.catalog) state.catalog = await (await fetch(import.meta.env.BASE_URL + 'catalog.json')).json();
  return state.catalog;
}

// ---------- auth ----------
async function loadMe() {
  state.me = null;
  if (!state.user) return;
  const { data } = await sb.from('private_profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.me = data;
}
const signIn = guard(async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
});
const signOut = guard(async () => { await sb.auth.signOut(); location.hash = '#/'; });
window.__signIn = signIn; window.__signOut = signOut;

function renderNav() {
  const cur = (location.hash.slice(2).split('/')[0]) || 'browse';
  const tab = (h, label) => `<a class="tab ${cur === h ? 'on' : ''}" href="#/${h === 'browse' ? '' : h}">${label}</a>`;
  $nav.innerHTML = `<a class="brand" href="#/">🏴‍☠️ Brunei TCG</a>
    ${tab('browse', 'Browse')}${tab('sell', 'Sell')}${state.user ? tab('mine', 'My activity') + tab('membership', isMember() ? '⭐ Member' : 'Upgrade') : ''}
    ${state.me?.is_admin ? tab('admin', 'Admin') : ''}
    ${state.user ? `<button class="btn sec" onclick="__signOut()">Sign out</button>` : `<button class="btn" onclick="__signIn()">Sign in with Google</button>`}`;
}

// ---------- router ----------
let unsub = null;
async function route() {
  if (unsub) { unsub(); unsub = null; }
  renderNav();
  if (!configured) return viewSetup();
  const [page, arg] = location.hash.slice(2).split('/');
  try {
    if (page === 'listing') return await viewListing(arg);
    if (page === 'sell') return await viewSell();
    if (page === 'mine') return await viewMine();
    if (page === 'membership') return await viewMembership();
    if (page === 'admin') return await viewAdmin();
    return await viewBrowse();
  } catch (e) { $app.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

const needLogin = () => `<div class="panel"><p>Please sign in to continue.</p><button class="btn" onclick="__signIn()">Sign in with Google</button></div>`;

function viewSetup() {
  $app.innerHTML = `<div class="panel"><h1>Setup needed</h1>
    <p>Add your Supabase project keys in a <code>.env</code> file (see <code>.env.example</code>), then rebuild.</p>
    <p class="muted">Steps are in README.md.</p></div>`;
}

// ---------- browse ----------
const tile = (l) => `<a class="tile" href="#/listing/${l.id}">
  <img loading="lazy" src="${esc(imgOf(l))}" alt="">
  <div class="b"><div class="code">${esc(l.card_code)} · ${esc(l.rarity || '')} · ${esc(l.condition)}</div>
  <div class="nm">${esc(l.card_name)}</div>
  <div class="row tight" style="justify-content:space-between;width:100%">
    <span class="price">${l.type === 'auction' ? bnd(l.current_bid ?? l.start_price) : bnd(l.price)}</span>
    <span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span></div>
  ${l.type === 'auction' ? `<div class="muted">${l.bid_count} bids · ${timerHtml(l.ends_at)}</div>` : ''}</div></a>`;

async function viewBrowse() {
  const f = JSON.parse(sessionStorage.getItem('filters') || '{"q":"","type":"","sort":"new"}');
  $app.innerHTML = `<h1>One Piece cards for sale in Brunei</h1>
    <div class="panel"><div class="row">
      <input id="q" placeholder="Search card code or name, e.g. OP01-001" value="${esc(f.q)}">
      <select id="type"><option value="">All types</option><option value="buy_now">Buy now</option><option value="auction">Auctions</option></select>
      <select id="sort"><option value="new">Newest</option><option value="end">Ending soon</option><option value="low">Price low</option><option value="high">Price high</option></select>
    </div></div><div id="list" class="grid"><p class="muted">Loading…</p></div>`;
  document.getElementById('type').value = f.type; document.getElementById('sort').value = f.sort;
  rpc('close_ended_auctions').catch(() => {});
  const load = async () => {
    const q = document.getElementById('q').value.trim(), type = document.getElementById('type').value, sort = document.getElementById('sort').value;
    sessionStorage.setItem('filters', JSON.stringify({ q, type, sort }));
    let req = sb.from('listings').select('*').eq('status', 'active').limit(100);
    if (type) req = req.eq('type', type);
    if (q) { const s = q.replace(/[%,()]/g, ' '); req = req.or(`card_code.ilike.%${s}%,card_name.ilike.%${s}%`); }
    if (sort === 'end') req = req.eq('type', 'auction').order('ends_at');
    else if (sort === 'low') req = req.order('price', { nullsFirst: false });
    else if (sort === 'high') req = req.order('price', { ascending: false, nullsFirst: false });
    else req = req.order('created_at', { ascending: false });
    const { data, error } = await req;
    const el = document.getElementById('list');
    if (!el) return;
    if (error) return (el.innerHTML = `<div class="notice err">${esc(error.message)}</div>`);
    el.innerHTML = data.length ? data.map(tile).join('') : '<p class="muted">No listings match. Be the first to sell!</p>';
  };
  let t; document.getElementById('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  document.getElementById('type').onchange = load; document.getElementById('sort').onchange = load;
  load();
}

// ---------- listing detail ----------
async function viewListing(id) {
  const draw = async () => {
    const { data: l, error } = await sb.from('listings')
      .select('*, seller:profiles!listings_seller_id_fkey(display_name), bidder:profiles!listings_current_bidder_fkey(display_name)')
      .eq('id', id).maybeSingle();
    if (error || !l) { $app.innerHTML = `<div class="notice err">${esc(error?.message || 'Listing not found')}</div>`; return; }
    const { data: bids } = l.type === 'auction'
      ? await sb.from('bids').select('amount,created_at,bidder:profiles!bids_bidder_id_fkey(display_name)').eq('listing_id', id).order('amount', { ascending: false }).limit(20)
      : { data: [] };
    const uid = state.user?.id, isSeller = uid === l.seller_id, isBuyer = uid === l.buyer_id;
    const photos = l.photos?.length ? l.photos : [l.catalog_image].filter(Boolean);
    const live = l.status === 'active' && (l.type === 'buy_now' || new Date(l.ends_at) > new Date());
    const minBid = l.current_bid == null ? Number(l.start_price) : Number(l.current_bid) + Number(l.bid_increment);

    let actions = '';
    if (!uid && live) actions = `<p class="muted">Sign in to ${l.type === 'auction' ? 'bid' : 'buy'}.</p><button class="btn" onclick="__signIn()">Sign in with Google</button>`;
    else if (live && !isSeller && l.type === 'buy_now') actions = `<button class="btn" id="buy">Buy now · ${bnd(l.price)}</button>
      <p class="muted">Nothing is charged on this site. Buying reserves the card; you and the seller then arrange payment and meet-up on WhatsApp.</p>`;
    else if (live && !isSeller) actions = l.current_bidder === uid
      ? `<div class="notice">You are the highest bidder.</div>`
      : `<div class="row tight"><input id="amt" type="number" step="0.5" min="${minBid}" value="${minBid}" style="width:140px"><button class="btn" id="bid">Place bid</button></div>
         <p class="muted">Minimum next bid ${bnd(minBid)}. A bid in the last 2 minutes extends the auction by 2 minutes. Winning bids are binding; no-shows get a strike (3 strikes = blocked).</p>`;
    else if (live && isSeller && l.bid_count === 0) actions = `<button class="btn bad" id="cancel">Cancel listing</button>`;
    else if (live && isSeller) actions = `<p class="muted">You cannot edit or cancel an auction that has bids.</p>`;

    if (l.status === 'reserved' && (isSeller || isBuyer)) {
      let c = null; try { c = (await rpc('get_contact', { p_listing: id }))?.[0]; } catch {}
      actions = `<div class="notice">${l.type === 'auction' ? 'Auction won' : 'Reserved'}. ${isSeller ? 'Contact the buyer to settle.' : 'Contact the seller to settle.'}</div>
        ${c ? `<p><b>${esc(c.display_name)}</b> · <a target="_blank" rel="noopener" href="https://wa.me/${esc(c.whatsapp)}">WhatsApp +${esc(c.whatsapp)}</a></p>` : ''}
        ${isSeller ? `<div class="row tight"><button class="btn ok" id="sold">Mark as sold</button><button class="btn sec" id="release">Release</button><button class="btn bad" id="noshow">Release + strike buyer</button></div>`
          : l.type === 'buy_now' ? `<button class="btn sec" id="unreserve">Cancel my reservation</button>` : ''}`;
    } else if (l.status === 'reserved') actions = `<div class="notice">Reserved by another buyer.</div>`;
    else if (l.status === 'sold') actions = `<div class="notice">Sold.</div>`;
    else if (l.status === 'ended') actions = `<div class="notice">Auction ended without a sale.</div>`;
    else if (l.status === 'cancelled') actions = `<div class="notice">Listing cancelled.</div>`;

    $app.innerHTML = `<p><a href="#/">← Back</a></p><div class="detail"><div>
      <img class="main" id="mainimg" src="${esc(photos[0] || '')}" alt="">
      <div class="thumbs">${photos.map((p) => `<img src="${esc(p)}" onclick="document.getElementById('mainimg').src=this.src">`).join('')}</div>
      ${l.photos?.length ? '' : '<p class="muted">Catalog image only. Ask the seller for photos of the actual card.</p>'}</div>
      <div><h1>${esc(l.card_name)}</h1>
      <p class="muted">${esc(l.card_code)} · ${esc(l.rarity || '')} · ${esc(l.set_id || '').toUpperCase()} · Condition ${esc(l.condition)} · ${esc(l.language)}</p>
      <p><span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span></p>
      <p class="price" style="font-size:1.5rem">${l.type === 'auction' ? bnd(l.current_bid ?? l.start_price) : bnd(l.price)}</p>
      ${l.type === 'auction' ? `<p>${l.bid_count} bids${l.bidder ? ` · leader ${esc(l.bidder.display_name)}` : ''}<br>${l.status === 'active' ? 'Ends in ' + timerHtml(l.ends_at).replace('class="timer"', 'class="timer" data-reload="1"') : 'Ended'}</p>` : ''}
      <p>Seller: <b>${esc(l.seller?.display_name)}</b></p>
      ${l.description ? `<p>${esc(l.description)}</p>` : ''}
      <div class="panel">${actions}</div>
      ${uid && !isSeller ? `<button class="btn sec" id="report">Report listing</button>` : ''}
      ${bids?.length ? `<h2 style="margin-top:1rem">Bid history</h2><table>${bids.map((b) => `<tr><td>${bnd(b.amount)}</td><td>${esc(b.bidder?.display_name)}</td><td class="muted">${new Date(b.created_at).toLocaleString()}</td></tr>`).join('')}</table>` : ''}
      </div></div>`;

    const on = (sel, fn) => { const el = document.getElementById(sel); if (el) el.onclick = guard(fn); };
    on('buy', async () => { if (!confirm('Reserve this card? You will arrange payment with the seller on WhatsApp.')) return; await rpc('buy_now', { p_listing: id }); toast('Reserved. Contact the seller.'); draw(); });
    on('bid', async () => { await rpc('place_bid', { p_listing: id, p_amount: Number(document.getElementById('amt').value) }); toast('Bid placed'); draw(); });
    on('cancel', async () => { if (!confirm('Cancel this listing?')) return; await rpc('cancel_listing', { p_listing: id }); draw(); });
    on('sold', async () => { await rpc('mark_sold', { p_listing: id }); draw(); });
    on('release', async () => { await rpc('seller_release', { p_listing: id, p_no_show: false }); draw(); });
    on('noshow', async () => { if (!confirm('Give the buyer a strike for not completing the deal?')) return; await rpc('seller_release', { p_listing: id, p_no_show: true }); draw(); });
    on('unreserve', async () => { await rpc('cancel_reservation', { p_listing: id }); draw(); });
    on('report', async () => {
      const reason = prompt('Why are you reporting this listing? (fake card, wrong price, scam…)');
      if (!reason) return;
      const { error } = await sb.from('reports').insert({ listing_id: id, reporter_id: uid, reason });
      if (error) throw error; toast('Report sent. Thank you.');
    });
  };
  await draw();
  const ch = sb.channel('l-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listings', filter: `id=eq.${id}` }, () => draw())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids', filter: `listing_id=eq.${id}` }, () => draw())
    .subscribe();
  unsub = () => sb.removeChannel(ch);
}

// ---------- sell ----------
async function resizeToJpeg(file, max = 1000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
}

async function viewSell() {
  if (!state.user) return ($app.innerHTML = needLogin());
  const cat = await loadCatalog();
  let chosen = null;
  const member = isMember();
  $app.innerHTML = `<h1>Sell a card</h1>
    <div class="panel"><label>1. Find your card (code or name)</label><input id="s" placeholder="e.g. OP05-060">
      <div id="res"></div><div id="chosen" class="muted">No card selected</div></div>
    <div class="panel" id="form" style="display:none">
      <label>2. Listing type</label>
      <div class="row tight"><label style="margin:0"><input type="radio" name="t" value="buy_now" checked style="width:auto"> Buy now</label>
      <label style="margin:0;${member ? '' : 'opacity:.6'}"><input type="radio" name="t" value="auction" ${member ? '' : 'disabled'} style="width:auto"> Auction ${member ? '' : '🔒'}</label></div>
      ${member ? '' : `<div class="notice">Auction selling is for paid members (BND ${esc(PRICE)}/month). <a href="#/membership">Upgrade</a>. Buy-now selling stays free.</div>`}
      <div class="row"><div><label>Condition</label><select id="cond"><option>M</option><option selected>NM</option><option>LP</option><option>MP</option><option>HP</option></select></div>
        <div><label>Language</label><select id="lang"><option>JP</option><option>EN</option><option>Other</option></select></div></div>
      <div id="bn"><label>Price (BND)</label><input id="price" type="number" min="0.5" step="0.5"></div>
      <div id="au" style="display:none"><div class="row"><div><label>Starting bid (BND)</label><input id="sp" type="number" min="0.5" step="0.5"></div>
        <div><label>Bid increment (BND)</label><input id="inc" type="number" min="0.5" step="0.5" value="1"></div>
        <div><label>Duration</label><select id="dur"><option value="24">1 day</option><option value="72" selected>3 days</option><option value="120">5 days</option><option value="168">7 days</option></select></div></div></div>
      <label>Description (optional)</label><textarea id="desc" rows="3" maxlength="1000"></textarea>
      <label>Photos of the actual card (up to 4, strongly recommended)</label><input id="ph" type="file" accept="image/*" multiple>
      <div id="wa-box"></div>
      <p><button class="btn" id="submit">Publish listing</button></p></div>`;

  const waBox = document.getElementById('wa-box');
  if (!state.me?.whatsapp) waBox.innerHTML = `<label>Your WhatsApp number (with country code, e.g. 6737123456). Shared only with the buyer after a deal is reserved.</label><input id="wa" inputmode="tel">`;

  const s = document.getElementById('s');
  s.oninput = () => {
    const q = s.value.trim().toLowerCase();
    if (q.length < 2) return (document.getElementById('res').innerHTML = '');
    const hits = cat.filter((c) => c[2].toLowerCase().includes(q) || c[3].toLowerCase().includes(q)).slice(0, 25);
    const el = document.getElementById('res');
    el.innerHTML = hits.map((c, i) => `<div class="pick" data-i="${i}"><img src="${catImg(c)}" loading="lazy"><div><b>${esc(c[2])}</b> ${esc(c[4])}<br><span class="muted">${esc(c[3])}</span></div></div>`).join('') || '<p class="muted">No match</p>';
    el.querySelectorAll('.pick').forEach((p) => (p.onclick = () => {
      chosen = hits[p.dataset.i];
      document.getElementById('chosen').innerHTML = `Selected: <b>${esc(chosen[2])}</b> ${esc(chosen[4])} · ${esc(chosen[3])}`;
      el.innerHTML = ''; document.getElementById('form').style.display = '';
    }));
  };
  document.querySelectorAll('input[name=t]').forEach((r) => (r.onchange = () => {
    const a = document.querySelector('input[name=t]:checked').value === 'auction';
    document.getElementById('bn').style.display = a ? 'none' : ''; document.getElementById('au').style.display = a ? '' : 'none';
  }));
  document.getElementById('submit').onclick = guard(async () => {
    if (!chosen) throw new Error('Pick a card first');
    const btn = document.getElementById('submit'); btn.disabled = true;
    try {
      const wa = document.getElementById('wa');
      if (wa) { await rpc('set_whatsapp', { p_number: wa.value }); await loadMe(); }
      const type = document.querySelector('input[name=t]:checked').value;
      const files = [...document.getElementById('ph').files].slice(0, 4), photos = [];
      for (const f of files) {
        const blob = await resizeToJpeg(f), path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from('listing-photos').upload(path, blob, { contentType: 'image/jpeg' });
        if (error) throw error;
        photos.push(sb.storage.from('listing-photos').getPublicUrl(path).data.publicUrl);
      }
      const p = { type, card_ref: chosen[1] + '-' + chosen[0], card_code: chosen[2], card_name: chosen[3], rarity: chosen[4], set_id: chosen[1],
        catalog_image: catImg(chosen), photos, condition: document.getElementById('cond').value, language: document.getElementById('lang').value,
        description: document.getElementById('desc').value };
      if (type === 'buy_now') p.price = Number(document.getElementById('price').value);
      else { p.start_price = Number(document.getElementById('sp').value); p.bid_increment = Number(document.getElementById('inc').value); p.duration_hours = Number(document.getElementById('dur').value); }
      const id = await rpc('create_listing', { p });
      toast('Listing published'); location.hash = '#/listing/' + id;
    } finally { btn.disabled = false; }
  });
}

// ---------- my activity ----------
async function viewMine() {
  if (!state.user) return ($app.innerHTML = needLogin());
  const uid = state.user.id;
  const [mine, bought, bidsR] = await Promise.all([
    sb.from('listings').select('*').eq('seller_id', uid).order('created_at', { ascending: false }),
    sb.from('listings').select('*').eq('buyer_id', uid).order('created_at', { ascending: false }),
    sb.from('bids').select('listing_id, listings(*)').eq('bidder_id', uid).order('created_at', { ascending: false }).limit(50),
  ]);
  const seen = new Set(), bidding = [];
  for (const b of bidsR.data || []) if (b.listings && !seen.has(b.listing_id)) { seen.add(b.listing_id); bidding.push(b.listings); }
  const st = (arr) => (arr || []).map((l) => `<div>${tile(l)}<div class="muted" style="text-align:center">${esc(l.status)}</div></div>`).join('');
  $app.innerHTML = `<h1>My activity</h1>
    ${state.me?.strikes ? `<div class="notice err">You have ${state.me.strikes} strike(s). At 3 you are blocked from bidding, buying and listing.</div>` : ''}
    <h2>My listings</h2>${mine.data?.length ? `<div class="grid">${st(mine.data)}</div>` : '<p class="muted">Nothing listed yet.</p>'}
    <h2 style="margin-top:1.2rem">Purchases and won auctions</h2>${bought.data?.length ? `<div class="grid">${st(bought.data)}</div>` : '<p class="muted">None yet.</p>'}
    <h2 style="margin-top:1.2rem">Auctions I bid on</h2>${bidding.length ? `<div class="grid">${st(bidding)}</div>` : '<p class="muted">None yet.</p>'}`;
}

// ---------- membership ----------
async function viewMembership() {
  if (!state.user) return ($app.innerHTML = needLogin());
  const { data: reqs } = await sb.from('membership_requests').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(5);
  const pending = reqs?.some((r) => r.status === 'pending');
  $app.innerHTML = `<h1>Membership</h1>
    <div class="panel"><p>${isMember() ? `⭐ Active until <b>${new Date(state.me.member_until).toLocaleDateString()}</b>` : 'Free plan'}</p>
    <table><tr><th></th><th>Free</th><th>Member (BND ${esc(PRICE)}/month)</th></tr>
      <tr><td>Sell with Buy now</td><td>✅</td><td>✅</td></tr>
      <tr><td>Buy and bid in auctions</td><td>✅</td><td>✅</td></tr>
      <tr><td>Sell by auction</td><td>🔒</td><td>✅</td></tr></table></div>
    <div class="panel"><h2>How to pay</h2>
      <p>1. Transfer BND ${esc(PRICE)} to: <b>${esc(BANK)}</b></p>
      <p>2. Enter your transfer reference below. We approve it manually, usually within a day, and add 30 days.</p>
      ${pending ? '<div class="notice">Your request is pending approval.</div>' : `<input id="ref" placeholder="Bank transfer reference"><p><button class="btn" id="req">Submit payment reference</button></p>`}</div>
    ${reqs?.length ? `<h2>Your requests</h2><table>${reqs.map((r) => `<tr><td>${esc(r.reference)}</td><td>${esc(r.status)}</td><td class="muted">${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}</table>` : ''}`;
  const b = document.getElementById('req');
  if (b) b.onclick = guard(async () => { await rpc('request_membership', { p_reference: document.getElementById('ref').value }); toast('Submitted'); viewMembership(); });
}

// ---------- admin ----------
async function viewAdmin() {
  if (!state.me?.is_admin) return ($app.innerHTML = '<div class="notice err">Admin only</div>');
  const [reqs, reps] = await Promise.all([
    sb.from('membership_requests').select('*, user:profiles!membership_requests_user_id_fkey(display_name)').eq('status', 'pending').order('created_at'),
    sb.from('reports').select('*, reporter:profiles!reports_reporter_id_fkey(display_name)').eq('resolved', false).order('created_at'),
  ]);
  $app.innerHTML = `<h1>Admin</h1><h2>Pending memberships</h2>
    ${reqs.data?.length ? `<table>${reqs.data.map((r) => `<tr><td>${esc(r.user?.display_name)}</td><td>${esc(r.reference)}</td><td>
      <button class="btn ok" data-ap="${r.id}">Approve 30d</button> <button class="btn sec" data-rj="${r.id}">Reject</button></td></tr>`).join('')}</table>` : '<p class="muted">None</p>'}
    <h2 style="margin-top:1.2rem">Open reports</h2>
    ${reps.data?.length ? `<table>${reps.data.map((r) => `<tr><td><a href="#/listing/${r.listing_id}">listing</a></td><td>${esc(r.reason)}<br><span class="muted">by ${esc(r.reporter?.display_name)}</span></td><td>
      <button class="btn bad" data-cl="${r.listing_id}" data-rp="${r.id}">Cancel listing</button> <button class="btn sec" data-rs="${r.id}">Dismiss</button></td></tr>`).join('')}</table>` : '<p class="muted">None</p>'}`;
  const bind = (attr, fn) => $app.querySelectorAll(`[${attr}]`).forEach((b) => (b.onclick = guard(async () => { await fn(b); viewAdmin(); })));
  bind('data-ap', (b) => rpc('admin_approve_membership', { p_request: Number(b.dataset.ap), p_days: 30 }));
  bind('data-rj', (b) => rpc('admin_reject_membership', { p_request: Number(b.dataset.rj) }));
  bind('data-cl', (b) => rpc('admin_cancel_listing', { p_listing: b.dataset.cl, p_report: Number(b.dataset.rp) }));
  bind('data-rs', (b) => rpc('admin_resolve_report', { p_report: Number(b.dataset.rs) }));
}

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
  if (!configured) return route();
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user || null;
  await loadMe();
  sb.auth.onAuthStateChange(async (_e, session) => {
    const changed = (session?.user?.id || null) !== (state.user?.id || null);
    state.user = session?.user || null;
    if (changed) { await loadMe(); route(); }
  });
  route();
}
boot();
