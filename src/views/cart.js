import { sb, state, esc, bnd, toast, rpc, loadCatalog, listingImg, confirmSheet, needLogin, bindLogin } from '../lib.js';
import { cartIds, removeFromCart } from '../cart.js';

export async function viewCart($app) {
  if (!state.user) { $app.innerHTML = `<h1>My cart</h1>${needLogin('use your cart')}`; bindLogin($app); return; }
  const cat = await loadCatalog();
  const draw = async () => {
    const ids = cartIds();
    if (!ids.length) { $app.innerHTML = `<h1>My cart</h1><div class="panel empty"><div class="empty-ic">🛒</div><p>Your cart is empty.</p><a class="btn" href="#/market">Browse the marketplace</a></div>`; return; }
    const { data } = await sb.from('listings').select('*, seller:profiles!listings_seller_id_fkey(display_name)').in('id', ids);
    const byId = new Map((data || []).map((l) => [l.id, l]));
    const rows = ids.map((id) => byId.get(id) || { id, gone: true });
    const ok = (l) => !l.gone && l.status === 'active' && l.type === 'buy_now' && l.seller_id !== state.user.id;
    const total = rows.filter(ok).reduce((s, l) => s + Number(l.price), 0);
    $app.innerHTML = `<div class="head"><h1>My cart</h1><span class="muted">${ids.length} item${ids.length > 1 ? 's' : ''}</span></div>
      ${rows.map((l) => {
        if (l.gone) return `<div class="order" data-id="${l.id}"><div class="grow muted">This listing no longer exists.</div><button class="btn sec sm-btn" data-rm="${l.id}">Remove</button></div>`;
        const c = cat.byRef.get(l.card_ref), live = ok(l);
        return `<div class="order ${live ? '' : 'dimmed'}" data-id="${l.id}"><a href="#/listing/${l.id}" class="oimg"><img src="${esc(listingImg(l))}" alt="${esc(l.card_code)}"></a>
          <div class="grow"><b>${esc(l.card_code)} ${esc(l.rarity || '')}</b>
          <div class="muted nm">${esc(c?.name || l.card_name)} · ${esc(l.condition)}</div>
          <div class="muted">Seller: ${esc(l.seller?.display_name)}</div>
          <div class="row tight between" style="margin-top:.3rem"><span class="price">${bnd(l.price)}</span>${live ? '' : `<span class="chip bad">${l.status === 'active' ? 'Not available' : l.status === 'reserved' ? 'On hold by another buyer' : 'No longer available'}</span>`}</div></div>
          <button class="x-btn" data-rm="${l.id}" aria-label="Remove from cart">✕</button></div>`;
      }).join('')}
      <div class="panel cart-total"><div class="row tight between"><span>Total (${rows.filter(ok).length} available)</span><b class="price" style="font-size:1.2rem">${bnd(total)}</b></div>
      <p class="muted">Nothing is charged on this site. Checkout reserves each card, then you and each seller arrange payment and meet-up on WhatsApp.</p>
      <button class="btn block" id="co" ${total ? '' : 'disabled'}>Reserve all available</button></div>`;
    $app.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { removeFromCart(b.dataset.rm); draw(); }));
    const co = $app.querySelector('#co');
    if (co) co.onclick = async () => {
      const list = rows.filter(ok);
      if (!(await confirmSheet(`Reserve ${list.length} card${list.length > 1 ? 's' : ''}?`, `Total ${bnd(total)}. You will contact each seller on WhatsApp to pay and collect.`, 'Reserve all'))) return;
      co.disabled = true; let done = 0; const fail = [];
      for (const l of list) { try { await rpc('buy_now', { p_listing: l.id }); removeFromCart(l.id); done++; } catch (e) { fail.push(`${l.card_code}: ${e.message || e}`); } }
      toast(fail.length ? `${done} reserved, ${fail.length} failed` : `${done} reserved. Open Orders to contact the sellers.`, !!fail.length);
      if (fail.length) console.warn(fail);
      draw();
    };
  };
  await draw();
}
