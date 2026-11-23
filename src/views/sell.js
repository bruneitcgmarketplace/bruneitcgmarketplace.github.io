import { sb, state, esc, bnd, toast, guard, rpc, loadMe, loadCatalog, loadInv, refBnd, catImg, cardImg, cardPicker, isMember, needLogin, bindLogin, setName, PRICE } from '../lib.js';

// Photos: up to 1600 px on the long side, JPEG quality 0.9, stepping down only if the file would exceed the 3 MB bucket limit.
async function resizeToJpeg(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, cv.width, cv.height);
  for (const q of [0.9, 0.85, 0.8, 0.7]) {
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
    if (blob.size <= 2.8 * 1024 * 1024) return blob;
  }
  return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.6));
}

export async function viewSell($app, preRef) {
  if (!state.user) { $app.innerHTML = `<h1>Sell a card</h1>${needLogin('list a card')}`; return bindLogin($app); }
  const cat = await loadCatalog(); await loadInv();
  let chosen = preRef ? cat.byRef.get(preRef) : null;
  const member = isMember();
  const draw = () => {
    const owned = chosen ? state.inv.get(chosen.ref) || 0 : 0, ref = chosen ? refBnd(chosen) : 0;
    $app.innerHTML = `<h1>Sell a card</h1>
      <div class="panel"><label>1. Card</label>
        ${chosen ? `<div class="pick" style="cursor:default">${cardImg(chosen)}<div><b>${esc(chosen.code)}</b> ${esc(chosen.rarity)}<br><span class="muted">${esc(chosen.name)} · ${esc(setName(chosen.set))}</span>${owned ? `<br><span class="badge bn">You own ${owned}</span>` : ''}</div></div>` : '<p class="muted">No card selected.</p>'}
        <div class="row tight"><button class="btn sec" id="pick">${chosen ? 'Change card' : 'Find a card'}</button>
        ${!chosen && state.inv.size ? `<a class="btn sec" href="#/inventory">Pick from my inventory</a>` : ''}</div></div>
      ${chosen ? `<div class="panel" id="form">
      <label>2. Listing type</label>
      <div class="row tight"><label class="inline"><input type="radio" name="t" value="buy_now" checked style="width:auto"> Buy now</label>
      <label class="inline" style="${member ? '' : 'opacity:.6'}"><input type="radio" name="t" value="auction" ${member ? '' : 'disabled'} style="width:auto"> Auction ${member ? '' : '🔒'}</label></div>
      ${member ? '' : `<div class="notice">Auction selling is for paid members (BND ${esc(PRICE)}/month). <a href="#/membership">Upgrade</a>. Buy-now selling stays free.</div>`}
      ${ref ? `<p class="muted">Reference price: <b>${bnd(ref)}</b> (Yuyutei JP shop price). <a href="#" id="use-ref">Use this price</a></p>` : ''}
      <div class="row"><div><label>Condition</label><select id="cond"><option value="M">M · Mint</option><option value="NM" selected>NM · Near mint</option><option value="LP">LP · Lightly played</option><option value="MP">MP · Moderately played</option><option value="HP">HP · Heavily played</option></select></div>
        <div><label>Language</label><select id="lang"><option>JP</option><option>EN</option><option>Other</option></select></div></div>
      <div id="bn"><label>Price (BND)</label><input id="price" type="number" min="0.5" step="0.5"></div>
      <div id="au" style="display:none"><div class="row"><div><label>Starting bid (BND)</label><input id="sp" type="number" min="0.5" step="0.5"></div>
        <div><label>Bid increment (BND)</label><input id="inc" type="number" min="0.5" step="0.5" value="1"></div>
        <div><label>Duration</label><select id="dur"><option value="24">1 day</option><option value="72" selected>3 days</option><option value="120">5 days</option><option value="168">7 days</option></select></div></div></div>
      <label>Description (optional)</label><textarea id="desc" rows="3" maxlength="1000" placeholder="Sleeves, centering, where to meet…"></textarea>
      <label>Photos of the actual card (up to 4, strongly recommended)</label><input id="ph" type="file" accept="image/*" multiple>
      ${state.me?.whatsapp ? '' : `<label>Your WhatsApp number (country code, e.g. 6737123456). Shared only with the other party once a deal is reserved.</label><input id="wa" inputmode="tel">`}
      <p><button class="btn" id="submit">Publish listing</button></p></div>` : ''}`;
    $app.querySelector('#pick').onclick = () => cardPicker((c) => { chosen = c; draw(); }, { title: 'Find the card to sell' });
    if (!chosen) return;
    const $ = (s) => $app.querySelector(s);
    const ur = $('#use-ref'); if (ur) ur.onclick = (e) => { e.preventDefault(); const v = (Math.round(ref * 2) / 2 || 0.5).toFixed(2); $('#price').value = v; $('#sp').value = v; };
    document.querySelectorAll('input[name=t]').forEach((r) => (r.onchange = () => {
      const a = document.querySelector('input[name=t]:checked').value === 'auction';
      $('#bn').style.display = a ? 'none' : ''; $('#au').style.display = a ? '' : 'none';
    }));
    $('#submit').onclick = guard(async () => {
      const btn = $('#submit'); btn.disabled = true;
      try {
        const wa = $('#wa'); if (wa) { await rpc('set_whatsapp', { p_number: wa.value }); await loadMe(); }
        const type = document.querySelector('input[name=t]:checked').value;
        const files = [...$('#ph').files].slice(0, 4), photos = [];
        for (const f of files) {
          const blob = await resizeToJpeg(f), path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
          const { error } = await sb.storage.from('listing-photos').upload(path, blob, { contentType: 'image/jpeg' });
          if (error) throw error;
          photos.push(sb.storage.from('listing-photos').getPublicUrl(path).data.publicUrl);
        }
        const p = { type, card_ref: chosen.ref, card_code: chosen.code, card_name: chosen.name, rarity: chosen.rarity, set_id: chosen.set, catalog_image: catImg(chosen), photos,
          condition: $('#cond').value, language: $('#lang').value, description: $('#desc').value };
        if (type === 'buy_now') p.price = Number($('#price').value);
        else { p.start_price = Number($('#sp').value); p.bid_increment = Number($('#inc').value); p.duration_hours = Number($('#dur').value); }
        const id = await rpc('create_listing', { p });
        toast('Listing published'); location.hash = '#/listing/' + id;
      } finally { btn.disabled = false; }
    });
  };
  draw();
}
