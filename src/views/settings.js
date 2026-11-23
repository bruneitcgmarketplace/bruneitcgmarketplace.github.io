import { sb, state, esc, bnd, toast, guard, rpc, loadMe, loadCatalog, loadInv, loadFx, isMember, needLogin, bindLogin, signOut, refBnd, PRICE } from '../lib.js';

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

export async function viewSettings($app) {
  const cat = await loadCatalog();
  const me = state.me, signed = !!state.user;
  const meta = state.user?.user_metadata || {};
  $app.innerHTML = `<h1>Settings</h1>
    ${signed ? `<div class="panel"><h2>Profile</h2><div class="row tight" style="margin-bottom:.4rem">${meta.avatar_url ? `<img class="avatar" src="${esc(meta.avatar_url)}" alt="">` : ''}<div><b>${esc(meta.full_name || state.user.email)}</b><div class="muted">${esc(state.user.email)}</div></div></div>
      <label>Display name (shown to buyers and sellers)</label><div class="row tight"><input id="dn" value="" style="max-width:260px"><button class="btn sec" id="dn-s">Save</button></div>
      <label>WhatsApp number (country code, no +). Shared only with the other party of a reserved or sold deal.</label><div class="row tight"><input id="wa" inputmode="tel" placeholder="6737123456" value="${esc(me?.whatsapp || '')}" style="max-width:260px"><button class="btn sec" id="wa-s">Save</button></div>
      <p class="muted">Strikes: ${me?.strikes ?? 0} of 3</p></div>
    <div class="panel"><h2>Membership</h2><p>${isMember() ? `⭐ Member until <b>${new Date(me.member_until).toLocaleDateString()}</b>` : `Free plan. Upgrade for auction selling (BND ${esc(PRICE)}/month).`}</p><a class="btn ${isMember() ? 'sec' : ''}" href="#/membership">${isMember() ? 'Manage membership' : 'Upgrade'}</a></div>` : needLogin('manage your profile')}
    <div class="panel"><h2>Prices</h2><p>Reference prices are Yuyutei (Japan shop) selling prices in JPY, converted to BND using the SGD rate because BND is pegged to SGD.</p>
      <p>Rate: <b>${state.fx.toFixed(5)}</b> BND per JPY <span class="muted">(${esc(state.fxSrc)})</span><br>Prices updated: <b>${esc(cat.updated)}</b></p>
      <label class="inline"><input type="checkbox" id="hd" ${localStorage.getItem('hd_images') !== '0' ? 'checked' : ''} style="width:auto"> Sharp card images (uses more mobile data)</label>
      <label>Manual rate override (BND per JPY, empty = automatic)</label><div class="row tight"><input id="fx" inputmode="decimal" value="${esc(localStorage.getItem('fx_manual') || '')}" style="max-width:160px"><button class="btn sec" id="fx-s">Apply</button></div></div>
    ${signed ? `<div class="panel"><h2>Data</h2><button class="btn sec" id="exp">Export inventory (CSV)</button></div>` : ''}
    <div class="panel"><h2>App</h2>${installEvt ? `<button class="btn" id="inst">Install app</button>` : `<p class="muted">Install: open the browser menu and choose "Add to Home screen" (iPhone: Share, then Add to Home Screen).</p>`}
      <p class="muted">Brunei TCG Marketplace · One Piece Card Game. Not affiliated with Bandai or Yuyutei. Deals are settled directly between buyer and seller; the site does not handle payments.</p></div>
    ${me?.is_admin ? `<div class="panel"><a class="btn sec" href="#/admin">Open admin</a></div>` : ''}
    ${signed ? `<p><button class="btn sec" id="so">Sign out</button></p>` : ''}`;
  bindLogin($app);
  const $ = (s) => $app.querySelector(s);
  if (signed) {
    sb.from('profiles').select('display_name').eq('id', state.user.id).maybeSingle().then(({ data }) => { if ($('#dn') && data) $('#dn').value = data.display_name; });
    $('#dn-s').onclick = guard(async () => { const v = $('#dn').value.trim(); if (v.length < 2 || v.length > 40) throw new Error('Name must be 2 to 40 characters'); const { error } = await sb.from('profiles').update({ display_name: v }).eq('id', state.user.id); if (error) throw error; toast('Saved'); });
    $('#wa-s').onclick = guard(async () => { await rpc('set_whatsapp', { p_number: $('#wa').value }); await loadMe(); toast('WhatsApp saved'); });
    $('#so').onclick = signOut;
    $('#exp').onclick = guard(async () => {
      await loadInv(true);
      const rows = [['ref', 'code', 'rarity', 'name', 'qty', 'ref_price_bnd']];
      for (const [ref, q] of state.inv) { const c = cat.byRef.get(ref); if (c) rows.push([ref, c.code, c.rarity, c.name, q, refBnd(c).toFixed(2)]); }
      const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'inventory.csv'; a.click();
    });
  }
  $('#hd').onchange = (e) => { localStorage.setItem('hd_images', e.target.checked ? '1' : '0'); toast(e.target.checked ? 'Sharp images on' : 'Data saver on'); };
  $('#fx-s').onclick = guard(async () => {
    const v = $('#fx').value.trim();
    if (v && !(parseFloat(v) > 0)) throw new Error('Enter a positive number, e.g. 0.0085');
    if (v) localStorage.setItem('fx_manual', v); else localStorage.removeItem('fx_manual');
    await loadFx(); toast('Rate updated'); viewSettings($app);
  });
  const inst = $('#inst'); if (inst) inst.onclick = async () => { installEvt.prompt(); installEvt = null; };
}
