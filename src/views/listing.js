import { sb, state, esc, bnd, toast, guard, rpc, loadCatalog, refBnd, catImg, upImg, sharpen, listingImg, timerHtml, confirmSheet, promptSheet, signIn, enlarge } from '../lib.js';

export async function viewListing($app, id, setUnsub) {
  const cat = await loadCatalog();
  const draw = async () => {
    const { data: l, error } = await sb.from('listings')
      .select('*, seller:profiles!listings_seller_id_fkey(display_name), bidder:profiles!listings_current_bidder_fkey(display_name)').eq('id', id).maybeSingle();
    if (error || !l) { $app.innerHTML = `<div class="notice err">${esc(error?.message || 'Listing not found')}</div>`; return; }
    const { data: bids } = l.type === 'auction'
      ? await sb.from('bids').select('amount,created_at,bidder:profiles!bids_bidder_id_fkey(display_name)').eq('listing_id', id).order('amount', { ascending: false }).limit(20)
      : { data: [] };
    const c = cat.byRef.get(l.card_ref), ref = c ? refBnd(c) : 0;
    const uid = state.user?.id, isSeller = uid === l.seller_id, isBuyer = uid === l.buyer_id;
    const photos = l.photos?.length ? l.photos : [l.catalog_image].filter(Boolean);
    const small = (u) => upImg(u, '250_350'), sharp = (u) => upImg(u, 'front'), thumb = (u) => upImg(u, '100_140');
    const live = l.status === 'active' && (l.type === 'buy_now' || new Date(l.ends_at) > new Date());
    const minBid = l.current_bid == null ? Number(l.start_price) : Number(l.current_bid) + Number(l.bid_increment);
    const shown = l.type === 'auction' ? Number(l.current_bid ?? l.start_price) : Number(l.price);

    let actions = '';
    if (!uid && live) actions = `<p class="muted">Sign in to ${l.type === 'auction' ? 'bid' : 'buy'}.</p><button class="btn" id="login">Sign in with Google</button>`;
    else if (live && !isSeller && l.type === 'buy_now') actions = `<button class="btn" id="buy">Buy now · ${bnd(l.price)}</button>
      <p class="muted">Nothing is charged on this site. Buying reserves the card; you and the seller then arrange payment and meet-up on WhatsApp.</p>`;
    else if (live && !isSeller) actions = l.current_bidder === uid
      ? `<div class="notice ok">You are the highest bidder.</div>`
      : `<div class="row tight"><input id="amt" type="number" step="0.5" min="${minBid}" value="${minBid}" style="width:140px"><button class="btn" id="bid">Place bid</button></div>
         <p class="muted">Minimum next bid ${bnd(minBid)}. A bid in the last 2 minutes extends the auction by 2 minutes. Winning bids are binding; no-shows get a strike (3 strikes = blocked).</p>`;
    else if (live && isSeller && l.bid_count === 0) actions = `<button class="btn bad" id="cancel">Cancel listing</button>`;
    else if (live && isSeller) actions = `<p class="muted">You cannot edit or cancel an auction that has bids.</p>`;

    if (l.status === 'reserved' && (isSeller || isBuyer)) {
      let ct = null; try { ct = (await rpc('get_contact', { p_listing: id }))?.[0]; } catch {}
      actions = `<div class="notice">${l.type === 'auction' ? 'Auction won' : 'Reserved'}. ${isSeller ? 'Contact the buyer to settle.' : 'Contact the seller to settle.'}</div>
        ${ct ? `<p><b>${esc(ct.display_name)}</b> · <a target="_blank" rel="noopener" href="https://wa.me/${esc(ct.whatsapp)}">WhatsApp +${esc(ct.whatsapp)}</a></p>` : ''}
        ${isSeller ? `<div class="row tight"><button class="btn ok" id="sold">Mark as sold</button><button class="btn sec" id="release">Release</button><button class="btn bad" id="noshow">Release + strike buyer</button></div>`
          : l.type === 'buy_now' ? `<button class="btn sec" id="unreserve">Cancel my reservation</button>` : ''}`;
    } else if (l.status === 'reserved') actions = `<div class="notice">Reserved by another buyer.</div>`;
    else if (l.status === 'sold') actions = `<div class="notice">Sold.</div>`;
    else if (l.status === 'ended') actions = `<div class="notice">Auction ended without a sale.</div>`;
    else if (l.status === 'cancelled') actions = `<div class="notice">Listing cancelled.</div>`;

    const diff = ref > 0 ? Math.round(((shown - ref) / ref) * 100) : null;
    $app.innerHTML = `<p><a href="javascript:history.back()">← Back</a></p><div class="detail"><div>
      <img class="main" id="mainimg" src="${esc(small(photos[0] || ''))}" alt="${esc(l.card_code)}" onerror="this.style.visibility='hidden'">
      <div class="thumbs">${photos.length > 1 || l.photos?.length ? photos.map((p) => `<img src="${esc(thumb(p))}" data-src="${esc(p)}" alt="">`).join('') : ''}</div>
      ${l.photos?.length ? '' : '<p class="muted">Catalogue image only. Ask the seller for photos of the actual card.</p>'}</div>
      <div><h1>${esc(c?.name || l.card_name)}</h1>
      <p class="muted"><a href="#/card/${esc(l.card_code)}">${esc(l.card_code)}</a> · ${esc(l.rarity || '')} · ${esc((l.set_id || '').toUpperCase())} · Condition ${esc(l.condition)} · ${esc(l.language)}</p>
      <p><span class="badge ${l.type === 'auction' ? 'auc' : 'bn'}">${l.type === 'auction' ? 'Auction' : 'Buy now'}</span></p>
      <p class="price" style="font-size:1.5rem">${bnd(shown)}</p>
      ${ref > 0 ? `<p class="muted">Reference ${bnd(ref)} (Yuyutei JP shop price)${l.type === 'buy_now' && diff !== null ? ` · ${diff <= 0 ? Math.abs(diff) + '% below' : diff + '% above'} reference` : ''}. Condition and local demand affect the real value.</p>` : ''}
      ${l.type === 'auction' ? `<p>${l.bid_count} bids${l.bidder ? ` · leader ${esc(l.bidder.display_name)}` : ''}<br>${l.status === 'active' ? 'Ends in ' + timerHtml(l.ends_at, true) : 'Ended'}</p>` : ''}
      <p>Seller: <b>${esc(l.seller?.display_name)}</b></p>
      ${l.description ? `<p>${esc(l.description)}</p>` : ''}
      <div class="panel">${actions}</div>
      ${uid && !isSeller ? `<button class="btn sec" id="report">Report listing</button>` : ''}
      ${bids?.length ? `<h2 style="margin-top:1rem">Bid history</h2><table>${bids.map((b) => `<tr><td>${bnd(b.amount)}</td><td>${esc(b.bidder?.display_name)}</td><td class="muted">${new Date(b.created_at).toLocaleString()}</td></tr>`).join('')}</table>` : ''}
      </div></div>`;

    const mainImg = $app.querySelector('#mainimg');
    sharpen(mainImg, sharp(photos[0] || ''));
    $app.querySelectorAll('.thumbs img').forEach((i) => (i.onclick = () => { mainImg.src = small(i.dataset.src); sharpen(mainImg, sharp(i.dataset.src)); }));
    mainImg.style.cursor = 'zoom-in'; mainImg.onclick = () => window.open(sharp(photos[0] || ''), '_blank', 'noopener');
    const on = (sel, fn) => { const el = $app.querySelector('#' + sel); if (el) el.onclick = guard(fn); };
    on('login', signIn);
    on('buy', async () => { if (!(await confirmSheet('Reserve this card?', 'You will arrange payment and meet-up with the seller on WhatsApp.', 'Reserve'))) return; await rpc('buy_now', { p_listing: id }); toast('Reserved. Contact the seller.'); draw(); });
    on('bid', async () => { await rpc('place_bid', { p_listing: id, p_amount: Number($app.querySelector('#amt').value) }); toast('Bid placed'); draw(); });
    on('cancel', async () => { if (!(await confirmSheet('Cancel listing?', 'The listing will be removed.', 'Cancel listing', true))) return; await rpc('cancel_listing', { p_listing: id }); draw(); });
    on('sold', async () => { await rpc('mark_sold', { p_listing: id }); toast('Marked as sold'); draw(); });
    on('release', async () => { await rpc('seller_release', { p_listing: id, p_no_show: false }); draw(); });
    on('noshow', async () => { if (!(await confirmSheet('Strike the buyer?', 'The buyer gets a strike for not completing the deal.', 'Release + strike', true))) return; await rpc('seller_release', { p_listing: id, p_no_show: true }); draw(); });
    on('unreserve', async () => { await rpc('cancel_reservation', { p_listing: id }); draw(); });
    on('report', async () => {
      const reason = await promptSheet('Report listing', 'Why? (fake card, wrong price, scam…)', { multiline: true, okLabel: 'Send report' });
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
  setUnsub(() => sb.removeChannel(ch));
}
