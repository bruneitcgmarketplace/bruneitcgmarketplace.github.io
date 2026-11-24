// "List all on Marketplace": one pop-up, one price and one quantity cap for every card in the collection.
import { sb, state, esc, bnd, toast, rpc, loadMe, loadCatalog, loadInv, invStats, refBnd, catImg, sheet } from '../lib.js';

const yuyuPrice = (c) => (c.jpy ? Math.round(refBnd(c) * 2) / 2 || 0.5 : 0);   // Yuyutei price in BND, to the nearest 0.5 (same as "Use this price" on the sell page)

export async function openListAll(refs = null) {   // refs = only these card versions (List selected); null = the whole collection
  const pick = refs ? new Set(refs) : null;
  await loadCatalog(); await loadInv(true);
  const { data: mine } = await sb.from('listings').select('card_ref').eq('seller_id', state.user.id).in('status', ['active', 'reserved']).limit(5000);
  const listed = new Map(); for (const l of mine || []) listed.set(l.card_ref, (listed.get(l.card_ref) || 0) + 1);
  const mineRows = invStats().rows.filter((r) => !pick || pick.has(r.c.ref));
  const rows = mineRows.map(({ c, q }) => ({ c, avail: Math.max(0, q - (listed.get(c.ref) || 0)), have: q })).filter((r) => r.avail > 0);
  const already = mineRows.reduce((s, r) => s + Math.min(r.q, listed.get(r.c.ref) || 0), 0);
  if (!rows.length) { toast(already ? (pick ? 'The selected cards are already listed' : 'Everything in your collection is already listed') : 'Your collection is empty'); return; }
  const needWa = !state.me?.whatsapp;
  const sh = sheet(`<div id="la">
    <h2>${pick ? `List ${rows.length} selected card${rows.length === 1 ? '' : 's'} on the Marketplace` : 'List everything on the Marketplace'}</h2>
    <p class="muted">Creates Buy now listings for ${pick ? 'the selected cards' : 'your collection'}. Each copy is its own listing.</p>
    <label>Price for every card (BND)</label>
    <input id="la-price" type="number" inputmode="decimal" min="0.5" step="0.5" placeholder="Leave empty to use each card's Yuyutei price">
    <label>Quantity to list per card (maximum)</label>
    <input id="la-qty" type="number" inputmode="numeric" min="1" step="1" placeholder="Leave empty to list all available copies">
    <label>Condition</label><select id="la-cond"><option value="M">M · Mint</option><option value="NM" selected>NM · Near mint</option><option value="LP">LP · Lightly played</option><option value="MP">MP · Moderately played</option></select>
    ${needWa ? `<label>Your WhatsApp number (country code, e.g. 6737123456). Shared only with the other party once a deal is reserved.</label><input id="la-wa" inputmode="tel">` : ''}
    <div class="notice" id="la-sum" style="margin-top:.7rem"></div>
    <div class="row tight" style="margin-top:.7rem"><button class="btn" id="la-go"></button><button class="btn sec" id="la-no">Cancel</button></div></div>`);
  const $ = (s) => sh.el.querySelector(s);
  const plan = () => {
    const pv = $('#la-price').value.trim(), qv = $('#la-qty').value.trim();
    const price = pv === '' ? null : Number(pv), cap = qv === '' ? Infinity : Math.floor(Number(qv));
    const bad = (price !== null && !(price >= 0.5)) ? 'Price must be at least BND 0.50' : (!(cap >= 1) ? 'Quantity must be 1 or more' : '');
    const items = []; let noPrice = 0;
    if (!bad) for (const r of rows) {
      const p = price ?? yuyuPrice(r.c); if (!(p > 0)) { noPrice++; continue; }
      items.push({ c: r.c, n: Math.min(r.avail, cap), p });
    }
    return { items, copies: items.reduce((s, i) => s + i.n, 0), noPrice, bad };
  };
  const refresh = () => {
    const pl = plan(), btn = $('#la-go');
    $('#la-sum').innerHTML = pl.bad ? esc(pl.bad) : `<b>${pl.copies}</b> listing${pl.copies === 1 ? '' : 's'} from <b>${pl.items.length}</b> card${pl.items.length === 1 ? '' : 's'}${already ? ` · ${already} copies already listed are skipped` : ''}${pl.noPrice ? ` · ${pl.noPrice} cards with no Yuyutei price skipped (enter a price to include them)` : ''}`;
    btn.textContent = pl.copies ? `List ${pl.copies} listing${pl.copies === 1 ? '' : 's'}` : 'Nothing to list'; btn.disabled = !!pl.bad || !pl.copies;
  };
  ['#la-price', '#la-qty'].forEach((s) => ($(s).oninput = refresh)); refresh();
  $('#la-no').onclick = () => sh.close();
  $('#la-go').onclick = async () => {
    const pl = plan(); if (pl.bad || !pl.copies) return;
    const go = $('#la-go'); go.disabled = true; $('#la-no').disabled = true;
    try {
      const wa = $('#la-wa'); if (wa) { await rpc('set_whatsapp', { p_number: wa.value }); await loadMe(); }
      const cond = $('#la-cond').value;
      const jobs = pl.items.flatMap(({ c, n, p }) => Array.from({ length: n }, () => ({ c, p })));
      let done = 0, failed = 0, err = null, i = 0;
      const worker = async () => {
        while (!err && i < jobs.length) {
          const { c, p } = jobs[i++];
          try {
            await rpc('create_listing', { p: { type: 'buy_now', card_ref: c.ref, card_code: c.code, card_name: c.name, rarity: c.rarity, set_id: c.set, catalog_image: catImg(c), photos: [], condition: cond, language: 'JP', description: '', price: p } });
            done++;
          } catch (e) { failed++; err = err || e; }
          go.textContent = `Listing… ${done} / ${jobs.length}`;
        }
      };
      go.textContent = `Listing… 0 / ${jobs.length}`;
      await Promise.all([worker(), worker(), worker(), worker()]);
      sh.close();
      toast(err ? `${done} listed, then stopped: ${err.message || err}` : `${done} listings published`);
      location.hash = '#/mylistings';
    } catch (e) { go.disabled = false; $('#la-no').disabled = false; go.textContent = 'Try again'; toast(e.message || String(e)); }
  };
}
