import '../home.css';
import { state, sb, esc, loadCatalog, loadInv, tile, bindLogin, rpc, groupBuyNow, primeMeta } from '../lib.js';
import { renderHomeStats, renderHomeFeeds, fmtBrunei } from '../home-content.js';

export async function viewHome($app) {
  await loadCatalog();
  $app.innerHTML = '<div class="loading">Loading…</div>';
  const signed = !!state.user;
  let feed = {}, feedChecked = 0, lastHtml = '';
  rpc('close_ended_auctions').catch(() => {});
  async function getFeed() {
    if (Date.now() - feedChecked < 10 * 60e3) return feed;
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'home-feed.json', {cache:'no-cache',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Feed unavailable');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid feed');
      feed = data; feedChecked = Date.now();
    } catch { /* Keep last-successful data and original source timestamps. */ }
    return feed;
  }
  const row = (title, result, href, empty) => `<section class="home-live"><div class="sec-h"><h2>${title}</h2><a href="${href}">See all</a></div>${result.error ? '<div class="panel muted">Listings are temporarily unavailable. Please try again shortly.</div>' : result.data?.length ? `<div class="hscroll">${groupBuyNow(result.data).slice(0,20).map(tile).join('')}</div>` : `<div class="panel muted">${empty}</div>`}</section>`;
  async function refresh() {
    try {
      const now = new Date().toISOString();
      const [inv, listings, auctions, listingCount, auctionCount, soldSum] = await Promise.all([
        signed ? loadInv(true).catch(() => null) : null,
        sb.from('listings').select('*').eq('status','active').eq('type','buy_now').order('price',{ascending:false}).order('created_at',{ascending:false}).limit(1000),
        sb.from('listings').select('*').eq('status','active').eq('type','auction').gt('ends_at',now).order('ends_at').limit(100),
        sb.from('listings').select('id',{count:'exact',head:true}).eq('status','active').eq('type','buy_now'),
        sb.from('listings').select('id',{count:'exact',head:true}).eq('status','active').eq('type','auction').gt('ends_at',now),
        Promise.resolve(sb.rpc?.('public_sold_summary')).then((r) => r?.data ?? null, () => null),
        getFeed(),
      ]);
      if (!$app.isConnected) return;
      // most expensive first, whenever it was added (auctions: current bid, or starting bid when nobody has bid)
      const worth = (l) => Number(l.type === 'auction' ? (l.current_bid ?? l.start_price) : l.price) || 0;
      const byWorth = (rows) => { const idx = new Map(rows.map((l, i) => [l.id, i])); return [...rows].sort((a, b) => worth(b) - worth(a) || idx.get(a.id) - idx.get(b.id)); };
      if (listings.data) { listings.data = byWorth(listings.data); await primeMeta(listings.data); }
      if (auctions.data) auctions.data = byWorth(auctions.data);
      const totalCards = inv ? [...inv.values()].reduce((sum,q) => sum + (Number.isSafeInteger(q) && q > 0 ? q : 0),0) : null;
      const hero = signed ? `<div class="hero"><div class="muted">Brunei One Piece TCG</div><h1>Your One Piece hub</h1><p class="muted">Manage your cards, discover listings and follow the latest updates.</p><div class="row tight"><a class="btn" href="#/inventory">Open inventory</a><a class="btn sec" href="#/scan">Scan cards</a></div></div>` : `<div class="hero"><div class="muted">Welcome</div><h1>Buy, sell and auction One Piece cards in Brunei</h1><p class="muted">Free to buy, sell and bid. List cards with Buy now or run an auction.</p><button class="btn" id="login-btn">Sign in with Google</button></div>`;
      const soldN = soldSum && Number.isFinite(soldSum.n) ? soldSum : null;
      const html = `${hero}${renderHomeStats({signed,totalCards,listingCount:listingCount.error ? null : listingCount.count,auctionCount:auctionCount.error ? null : auctionCount.count,soldCount:soldN ? soldN.n : null,soldWeek:soldN ? Number(soldN.n7 || 0) : null})}
        <p class="feed-meta price-stamp">Card prices last refreshed: <b>${esc(fmtBrunei(state.cat?.updated))}</b> (Brunei time). Prices refresh every 3 hours.</p>
        ${row('Live listing',listings,'#/market?type=buy_now','No buy-now listings yet. Sell a card to get started.')}
        ${row('Live auction',auctions,'#/market?type=auction','No live auctions right now. Check back soon.')}
        ${renderHomeFeeds(feed)}
        <p class="feed-meta home-refresh-note">Live counts refresh every minute. News, releases and Yuyutei sources refresh automatically every three hours. Reference prices are Japanese shop prices, not guaranteed local values.</p>`;
      if (html !== lastHtml) { $app.innerHTML = html; lastHtml = html; bindLogin($app); }
    } catch (error) {
      if ($app.isConnected && !lastHtml) $app.innerHTML = `<div class="notice err">Home could not load. ${esc(error.message || error)}</div>${renderHomeFeeds(feed)}`;
    } finally {
      if ($app.isConnected) setTimeout(refresh,60000);
    }
  }
  await refresh();
  // Live listing / Live auction rails drift slowly to the right; they pause while touched, then continue.
  if (typeof requestAnimationFrame === 'function' && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    const SPEED = 24, st = new WeakMap(); let last = 0;   // pixels per second
    const tick = (ts) => {
      if (!$app.isConnected) return;
      const dt = last ? Math.min(ts - last, 100) / 1000 : 0; last = ts;
      for (const el of $app.querySelectorAll('.home-live .hscroll')) {
        let s = st.get(el);
        if (!s) {
          s = { pos: el.scrollLeft, hold: ts + 1500, end: 0 }; st.set(el, s);
          const pause = () => { s.hold = performance.now() + 6000; };
          for (const ev of ['touchstart', 'pointerdown', 'wheel', 'mouseenter', 'focusin']) el.addEventListener(ev, pause, { passive: true });
        }
        if (ts < s.hold) { s.pos = el.scrollLeft; s.end = 0; continue; }
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 4) continue;
        if (s.pos >= max - 1) {
          if (!s.end) s.end = ts;
          else if (ts - s.end > 2000) { el.scrollLeft = 0; s.pos = 0; s.end = 0; s.hold = ts + 1500; }
          continue;
        }
        s.pos = Math.min(max, s.pos + SPEED * dt); el.scrollLeft = s.pos;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
