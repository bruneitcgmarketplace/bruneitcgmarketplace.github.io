import { sb, state, esc, bnd, toast, guard, rpc, loadMe, loadCatalog, loadInv, refBnd, catImg, cardImg, cardPicker, KINDS, isMember, needLogin, bindLogin, setName, PRICE } from '../lib.js';

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
  let kind = 'card';   // 'card' = catalogue card; anything else is a manual item with its own photos
  // copies of this card already on sale, so "sell all" only offers what is still free
  let listedN = 0;
  const loadListed = async () => { listedN = 0; if (!chosen) return; const { data } = await sb.from('listings').select('id').eq('seller_id', state.user.id).eq('card_ref', chosen.ref).in('status', ['active', 'reserved']); listedN = (data || []).length; };
  await loadListed();
  const member = isMember();
  const HELP = { promo: ['e.g. Monkey.D.Luffy Tournament Promo', 'e.g. P-001'], pack: ['e.g. OP-13 Booster Pack (Japanese)', 'e.g. OP13'], box: ['e.g. OP-13 Booster Box (Japanese, sealed)', 'e.g. OP13'], case: ['e.g. OP-13 Booster Box Case (12 boxes)', 'e.g. OP13'], slab: ['e.g. Luffy OP05-119 SEC', 'e.g. OP05-119'], other: ['e.g. Playmat, sleeves, deck box', ''] };
  const kindBar = () => `<div class="kinds" id="kinds">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="${k === kind ? 'on' : ''}" data-k="${k}">${v}</button>`).join('')}</div>`;
  const bindKinds = () => $app.querySelectorAll('#kinds button').forEach((b) => (b.onclick = () => { kind = b.dataset.k; draw(); }));
  const uploadPhotos = async (files) => {
    const out = [];
    for (const f of files.slice(0, 4)) {
      const blob = await resizeToJpeg(f), path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from('listing-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      out.push(sb.storage.from('listing-photos').getPublicUrl(path).data.publicUrl);
    }
    return out;
  };
  // manual item: sealed pack / booster box / case / graded slab / promo or other card
  const drawManual = () => {
    const h = HELP[kind] || ['', ''];
    $app.innerHTML = `<h1>Sell</h1>${kindBar()}
      <div class="panel"><label>1. ${esc(KINDS[kind])} details</label>
        <label>Name</label><input id="mn" maxlength="120" placeholder="${esc(h[0])}">
        <div class="row"><div><label>Set / code (optional)</label><input id="mc" maxlength="30" placeholder="${esc(h[1])}"></div>
        ${kind === 'slab' ? `<div><label>Grading company</label><select id="gc"><option>PSA</option><option>BGS</option><option>CGC</option><option>ARS</option><option>Other</option></select></div><div><label>Grade</label><input id="gr" maxlength="10" placeholder="10"></div>` : ''}
        ${kind === 'promo' ? `<div><label>Rarity (optional)</label><input id="mr" maxlength="20" placeholder="P-SR"></div>` : ''}</div></div>
      <div class="panel" id="form"><label>2. Listing type</label>
        <div class="row tight"><label class="inline"><input type="radio" name="t" value="buy_now" checked style="width:auto"> Buy now</label>
        <label class="inline" style="${member ? '' : 'opacity:.6'}"><input type="radio" name="t" value="auction" ${member ? '' : 'disabled'} style="width:auto"> Auction ${member ? '' : '🔒'}</label></div>
        <div class="row">${kind === 'promo' ? `<div><label>Condition</label><select id="cond"><option value="M">M · Mint</option><option value="NM" selected>NM · Near mint</option><option value="LP">LP · Lightly played</option><option value="MP">MP · Moderately played</option><option value="HP">HP · Heavily played</option></select></div>` : ''}
          <div><label>Language</label><select id="lang"><option>JP</option><option>EN</option><option>Other</option></select></div></div>
        <div id="bn"><label>Price (BND)</label><input id="price" type="number" min="0.5" step="0.5"></div>
        <div id="qt"><label>Quantity (identical items, listed one by one)</label><input id="qty" type="number" min="1" max="50" value="1" style="max-width:7rem"></div>
        <div id="au" style="display:none"><div class="row"><div><label>Starting bid (BND)</label><input id="sp" type="number" min="0.5" step="0.5"></div>
          <div><label>Bid increment (BND)</label><input id="inc" type="number" min="0.5" step="0.5" value="1"></div>
          <div><label>Duration</label><select id="dur"><option value="24">1 day</option><option value="72" selected>3 days</option><option value="120">5 days</option><option value="168">7 days</option></select></div></div></div>
        <label>Description (optional)</label><textarea id="desc" rows="3" maxlength="1000" placeholder="${kind === 'slab' ? 'Cert number, centering, where to meet…' : 'Edition, sealed condition, where to meet…'}"></textarea>
        <label>Photos (required, up to 4)</label><input id="ph" type="file" accept="image/*" multiple>
        ${state.me?.whatsapp ? '' : `<label>Your WhatsApp number (e.g. 8123456 or 6738123456). Shared only with the other party once a deal is reserved.</label><input id="wa" inputmode="tel">`}
        <p><button class="btn" id="submit">Publish listing</button></p></div>`;
    bindKinds();
    const $ = (s) => $app.querySelector(s);
    document.querySelectorAll('input[name=t]').forEach((r) => (r.onchange = () => {
      const a = document.querySelector('input[name=t]:checked').value === 'auction';
      $('#bn').style.display = a ? 'none' : ''; $('#au').style.display = a ? '' : 'none'; $('#qt').style.display = a ? 'none' : '';
    }));
    $('#submit').onclick = guard(async () => {
      const btn = $('#submit'); btn.disabled = true;
      try {
        const name = $('#mn').value.trim(); if (!name) throw new Error('Enter a name for the item');
        const files = [...$('#ph').files]; if (!files.length) throw new Error('Add at least one photo');
        const type = document.querySelector('input[name=t]:checked').value;
        if (type === 'buy_now' && !(Number($('#price').value) > 0)) throw new Error('Enter a price');
        if (type === 'auction' && !(Number($('#sp').value) > 0)) throw new Error('Enter a starting bid');
        let rarity = ''; if (kind === 'slab') { const g = $('#gr').value.trim(); if (!g) throw new Error('Enter the grade'); rarity = `${$('#gc').value} ${g}`; } else if (kind === 'promo') rarity = $('#mr').value.trim();
        const wa = $('#wa'); if (wa) { await rpc('set_whatsapp', { p_number: wa.value }); await loadMe(); }
        const photos = await uploadPhotos(files);
        const p = { type, kind, card_name: name, card_code: $('#mc').value.trim(), rarity, photos, condition: kind === 'promo' ? $('#cond').value : 'NM', language: $('#lang').value, description: $('#desc').value };
        if (type === 'buy_now') p.price = Number($('#price').value);
        else { p.start_price = Number($('#sp').value); p.bid_increment = Number($('#inc').value); p.duration_hours = Number($('#dur').value); }
        const n = type === 'buy_now' ? Math.max(1, Math.min(Math.floor(Number($('#qty').value) || 1), 50)) : 1;
        let made = 0, first = null, err = null;
        for (let i = 0; i < n; i++) { try { const id = await rpc('create_listing', { p }); first = first || id; made++; } catch (e) { err = e; break; } }
        if (!made) throw err;
        toast(made === 1 ? 'Listing published' : `${made} listings published${err ? ' (stopped: ' + (err.message || err) + ')' : ''}`);
        location.hash = made === 1 ? '#/listing/' + first : '#/mylistings';
      } finally { btn.disabled = false; }
    });
  };
  const draw = () => {
    if (kind !== 'card') return drawManual();
    const owned = chosen ? state.inv.get(chosen.ref) || 0 : 0, ref = chosen ? refBnd(chosen) : 0;
    const avail = owned ? Math.min(Math.max(0, owned - listedN), 50) : 1;   // copies you can list in one go
    $app.innerHTML = `<h1>Sell</h1>${kindBar()}
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
      <div id="qt" ${avail > 1 ? '' : 'style="display:none"'}><label>Quantity to sell (you have ${owned}${listedN ? ', ' + listedN + ' already listed' : ''})</label>
        <div class="row tight"><input id="qty" type="number" min="1" max="${avail}" value="1" style="max-width:7rem"><button class="btn sec" id="qall" type="button">Sell all (${avail})</button></div>
        <p class="muted">Each copy is listed separately at the same price, so buyers can take them one at a time. Up to 50 at once.</p></div>
      <div id="au" style="display:none"><div class="row"><div><label>Starting bid (BND)</label><input id="sp" type="number" min="0.5" step="0.5"></div>
        <div><label>Bid increment (BND)</label><input id="inc" type="number" min="0.5" step="0.5" value="1"></div>
        <div><label>Duration</label><select id="dur"><option value="24">1 day</option><option value="72" selected>3 days</option><option value="120">5 days</option><option value="168">7 days</option></select></div></div></div>
      <label>Description (optional)</label><textarea id="desc" rows="3" maxlength="1000" placeholder="Sleeves, centering, where to meet…"></textarea>
      <label>Photos of the actual card (up to 4, strongly recommended)</label><input id="ph" type="file" accept="image/*" multiple>
      ${state.me?.whatsapp ? '' : `<label>Your WhatsApp number (country code, e.g. 6737123456). Shared only with the other party once a deal is reserved.</label><input id="wa" inputmode="tel">`}
      <p><button class="btn" id="submit">Publish listing</button></p></div>` : ''}`;
    bindKinds();
    $app.querySelector('#pick').onclick = () => cardPicker(async (c) => { chosen = c; await loadListed(); draw(); }, { title: 'Find the card to sell' });
    if (!chosen) return;
    const $ = (s) => $app.querySelector(s);
    const qa = $('#qall'); if (qa) qa.onclick = () => { $('#qty').value = avail; };
    const ur = $('#use-ref'); if (ur) ur.onclick = (e) => { e.preventDefault(); const v = (Math.round(ref * 2) / 2 || 0.5).toFixed(2); $('#price').value = v; $('#sp').value = v; };
    document.querySelectorAll('input[name=t]').forEach((r) => (r.onchange = () => {
      const a = document.querySelector('input[name=t]:checked').value === 'auction';
      $('#bn').style.display = a ? 'none' : ''; $('#au').style.display = a ? '' : 'none'; $('#qt').style.display = a || avail <= 1 ? 'none' : '';
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
        const n = type === 'buy_now' && avail > 1 ? Math.max(1, Math.min(Math.floor(Number($('#qty').value) || 1), avail)) : 1;
        let made = 0, first = null, err = null;
        for (let i = 0; i < n; i++) { try { const id = await rpc('create_listing', { p }); first = first || id; made++; } catch (e) { err = e; break; } }
        if (!made) throw err;
        toast(made === 1 ? 'Listing published' : `${made} listings published${err ? ' (stopped: ' + (err.message || err) + ')' : ''}`);
        location.hash = made === 1 ? '#/listing/' + first : '#/mylistings';
      } finally { btn.disabled = false; }
    });
  };
  draw();
}
