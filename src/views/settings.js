import { sb, state, esc, bnd, toast, guard, rpc, loadMe, loadCatalog, loadInv, loadFx, isMember, needLogin, bindLogin, signOut, refBnd, PRICE } from '../lib.js';
import { fmtBrunei } from '../home-content.js';
import { pushStatus, enablePush, disablePush } from '../push.js';

// Install prompt (Chrome/Android). Captured early so the admin-only App panel can offer it.
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; });

export async function viewSettings($app) {
  const cat = await loadCatalog();
  const me = state.me, signed = !!state.user;
  const meta = state.user?.user_metadata || {};
  $app.innerHTML = `<h1>Settings</h1>
    ${signed ? `<div class="panel"><h2>Profile</h2><div class="row tight" style="margin-bottom:.4rem">${meta.avatar_url ? `<img class="avatar" src="${esc(meta.avatar_url)}" alt="">` : ''}<div><b>${esc(meta.full_name || state.user.email)}</b><div class="muted">${esc(state.user.email)}</div></div></div>
      <label>Display name (shown to buyers and sellers)</label><div class="row tight"><input id="dn" value="" style="max-width:260px"><button class="btn sec" id="dn-s">Save</button></div>
      <label>WhatsApp number (country code, no +). Shared only with the other party of a reserved or sold deal.</label><div class="row tight"><input id="wa" inputmode="tel" placeholder="6737123456" value="${esc(me?.whatsapp || '')}" style="max-width:260px"><button class="btn sec" id="wa-s">Save</button></div>
      <p class="muted">Strikes: ${me?.strikes ?? 0} of 3</p></div>
` : needLogin('manage your profile')}
    <div class="panel"><h2>Prices</h2><p>Reference prices are Yuyutei (Japan shop) selling prices in JPY, converted to BND using the SGD rate because BND is pegged to SGD.</p>
      <p>Rate: <b>${state.fx.toFixed(5)}</b> BND per JPY <span class="muted">(${esc(state.fxSrc)})</span><br>Prices last refreshed: <b>${esc(fmtBrunei(cat.updated))}</b> (Brunei time)</p>
      <button class="btn sec" id="px-r">Refresh prices</button>
      <p class="muted" style="margin:.4rem 0 .8rem">Reloads the latest published Yuyutei prices and the live exchange rate. The site re-reads Yuyutei every 3 hours.</p>
      <label class="inline"><input type="checkbox" id="hd" ${localStorage.getItem('hd_images') !== '0' ? 'checked' : ''} style="width:auto"> Sharp card images (uses more mobile data)</label>
      <label>Manual rate override (BND per JPY, empty = automatic)</label><div class="row tight"><input id="fx" inputmode="decimal" value="${esc(localStorage.getItem('fx_manual') || '')}" style="max-width:160px"><button class="btn sec" id="fx-s">Apply</button></div></div>
    ${signed ? `<div class="panel" id="pushp"><h2>Phone notifications</h2><p class="muted" id="pushmsg">Checking…</p><button class="btn sec" id="pushbtn" hidden></button></div>` : ''}
    ${signed ? `<div class="panel"><h2>Data</h2><button class="btn sec" id="exp">Export inventory (CSV)</button></div>` : ''}
    ${me?.is_admin ? `<div class="panel"><a class="btn sec" href="#/admin">Open admin</a></div>
    <div class="panel"><h2>App (admin only)</h2>${window.matchMedia?.('(display-mode: standalone)').matches ? '<p class="muted">Already running as an installed app.</p>' : installEvt ? `<button class="btn" id="inst">Install app</button>` : `<p class="muted">Install: open the browser menu and choose "Install app" or "Add to Home screen" (iPhone: Share, then Add to Home Screen).</p>`}</div>` : ''}
    ${signed ? `<p><button class="btn sec" id="so">Sign out</button></p>` : ''}`;
  bindLogin($app);
  const $ = (s) => $app.querySelector(s);
  const inst = $('#inst'); if (inst) inst.onclick = async () => { const e = installEvt; installEvt = null; await e.prompt(); viewSettings($app); };
  if (signed) {
    const drawPush = async () => {
      const st = await pushStatus(), msg = $('#pushmsg'), btn = $('#pushbtn');
      if (!msg) return;
      const T = { unsupported: 'This browser cannot show phone notifications. On iPhone, add the site to the Home Screen first.', denied: 'Notifications are blocked for this site. Allow them in the browser or phone settings, then come back.', on: 'On. This phone gets an alert when someone clicks Buy now on your card, and when a seller marks your order as sold.', off: 'Off. Turn on to get an alert when someone clicks Buy now on your card, or when a seller marks your order as sold.' };
      msg.textContent = T[st]; btn.hidden = st === 'unsupported' || st === 'denied';
      btn.textContent = st === 'on' ? 'Turn off on this phone' : 'Turn on notifications'; btn.className = 'btn ' + (st === 'on' ? 'sec' : '');
      btn.onclick = guard(async () => { if (st === 'on') await disablePush(); else await enablePush(); localStorage.setItem('push_dismiss', '1'); toast(st === 'on' ? 'Notifications off' : 'Phone alerts are on'); drawPush(); });
    };
    drawPush();
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
  $('#px-r').onclick = guard(async () => {
    const btn = $('#px-r'), old = cat.updated; btn.disabled = true; btn.textContent = 'Refreshing...';
    try {
      await loadFx(true); const fresh = await loadCatalog(true);
      toast(fresh.updated !== old ? 'Prices updated to ' + fresh.updated : 'Already the latest prices (' + fresh.updated + ')');
      viewSettings($app);
    } finally { btn.disabled = false; btn.textContent = 'Refresh prices'; }
  });
  $('#hd').onchange = (e) => { localStorage.setItem('hd_images', e.target.checked ? '1' : '0'); toast(e.target.checked ? 'Sharp images on' : 'Data saver on'); };
  $('#fx-s').onclick = guard(async () => {
    const v = $('#fx').value.trim();
    if (v && !(parseFloat(v) > 0)) throw new Error('Enter a positive number, e.g. 0.0085');
    if (v) localStorage.setItem('fx_manual', v); else localStorage.removeItem('fx_manual');
    await loadFx(); toast('Rate updated'); viewSettings($app);
  });
}
