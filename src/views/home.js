import { sb, state, esc, bnd, bndShort, loadCatalog, loadInv, invStats, refBnd, cardImg, setName, tile, needLogin, bindLogin, rpc, isMember, enlarge } from '../lib.js';

export const setCircle = (s, pct) => {
  const deg = Math.round((pct || 0) * 3.6);
  return `<a class="setc" href="#/set/${s.id}"><div class="ring" style="--deg:${deg}deg"><span>${s.id.toUpperCase()}</span></div>
    <div class="sn">${esc(s.name)}</div>${pct != null ? `<div class="muted">${Math.round(pct)}%</div>` : ''}</a>`;
};

export async function viewHome($app) {
  const cat = await loadCatalog();
  $app.innerHTML = `<div class="loading">Loading…</div>`;
  const signed = !!state.user;
  if (signed) await loadInv();
  rpc('close_ended_auctions').catch(() => {});
  const [soon, fresh, counts, mine] = await Promise.all([
    sb.from('listings').select('*').eq('status', 'active').eq('type', 'auction').gt('ends_at', new Date().toISOString()).order('ends_at').limit(8),
    sb.from('listings').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(8),
    sb.from('listings').select('type', { count: 'exact' }).eq('status', 'active').limit(1000),
    signed ? sb.from('listings').select('id,status,seller_id,buyer_id').or(`seller_id.eq.${state.user.id},buyer_id.eq.${state.user.id}`).in('status', ['reserved']) : { data: [] },
  ]);
  const active = counts.data || [], auctions = active.filter((l) => l.type === 'auction').length;
  const st = signed ? invStats() : null;
  const waiting = (mine.data || []).length;

  let hero;
  if (!signed) hero = `<div class="hero"><div class="muted">Welcome</div><h1>Buy, sell and auction One Piece cards in Brunei</h1>
    <p class="muted">Free to buy and bid. Sell with Buy now for free, or upgrade to run auctions.</p><button class="btn" id="login-btn">Sign in with Google</button></div>`;
  else hero = `<div class="hero"><div class="muted">Collection value</div><div class="big-num">${bnd(st.value)}</div>
    <div class="muted">${st.count} cards · ${st.unique} unique · reference prices (Yuyutei JP shop price, converted at ${state.fx.toFixed(5)} BND/JPY)</div>
    <div class="row tight" style="margin-top:.6rem"><a class="btn" href="#/inventory">Open inventory</a><a class="btn sec" href="#/scan">Scan cards</a></div></div>`;

  const tiles = `<div class="stats">
    <a class="stat" href="#/explore"><b>${active.length}</b><span>For sale</span></a>
    <a class="stat" href="#/explore?type=auction"><b>${auctions}</b><span>Live auctions</span></a>
    ${signed ? `<a class="stat ${waiting ? 'hot' : ''}" href="#/orders"><b>${waiting}</b><span>Awaiting settlement</span></a>` : ''}
    ${signed && !isMember() ? `<a class="stat" href="#/membership"><b>⭐</b><span>Unlock auctions</span></a>` : ''}</div>`;

  const row = (title, arr, link) => arr?.length ? `<div class="sec-h"><h2>${title}</h2>${link ? `<a href="${link}">See all</a>` : ''}</div><div class="hscroll">${arr.map(tile).join('')}</div>` : '';

  let insights = '';
  if (signed && st.unique) {
    const top = [...st.rows].sort((a, b) => b.v - a.v).slice(0, 5);
    const bySet = [...st.bySet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxV = Math.max(...bySet.map((x) => x[1]), 1);
    const done = cat.sets.filter((s) => st.owned.get(s.id)).slice(0, 8);
    insights = `<div class="sec-h"><h2>Your collection</h2></div>
      <div class="panel"><h3>Top cards</h3>${top.map((r) => `<div class="line" data-ref="${esc(r.c.ref)}">${cardImg(r.c, 'xs')}<div class="grow"><b>${esc(r.c.code)}</b> ${esc(r.c.rarity)}<div class="muted">${esc(r.c.name)} × ${r.q}</div></div><b>${bnd(r.v)}</b></div>`).join('')}</div>
      <div class="panel"><h3>Value by set</h3>${bySet.map(([id, v]) => `<div class="bar"><span class="bl">${id.toUpperCase()}</span><div class="bt"><i style="width:${(v / maxV) * 100}%"></i></div><span class="bv">${bndShort(v)}</span></div>`).join('')}</div>
      <div class="sec-h"><h2>Set completion</h2></div>
      <div class="setgrid">${done.map((s) => setCircle(s, ((st.owned.get(s.id)?.size || 0) / s.count) * 100)).join('')}</div>`;
  }

  const newest = cat.sets.filter((s) => /^(op|eb|prb)/.test(s.id)).slice(0, 12);
  $app.innerHTML = `${hero}${tiles}
    ${row('Auctions ending soon', soon.data, '#/explore?type=auction')}
    ${row('Newest listings', fresh.data, '#/explore')}
    ${!active.length ? `<div class="panel center"><p>No listings yet. Be the first to sell a card!</p><a class="btn" href="#/sell">Sell a card</a></div>` : ''}
    ${insights}
    <div class="sec-h"><h2>Browse by set</h2><a href="#/explore?mode=sets">All sets</a></div>
    <div class="setgrid">${newest.map((s) => setCircle(s, null)).join('')}</div>
    <p class="muted" style="margin-top:1.2rem">Card catalogue and reference prices from Yuyutei, updated ${esc(cat.updated)}. Reference prices are Japanese shop selling prices, not guaranteed local values.</p>`;
  bindLogin($app);
  $app.querySelectorAll('.line[data-ref]').forEach((el) => (el.onclick = () => enlarge(state.cat.byRef.get(el.dataset.ref))));
}
