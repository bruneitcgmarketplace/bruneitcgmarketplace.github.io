import { state, esc, isMember, needLogin, bindLogin, signOut, avatarHtml, toast, guard } from '../lib.js';
import { changeAvatar, removeAvatar, isCustomAvatar } from '../avatar.js';

export async function viewAccount($app) {
  if (!state.user) { $app.innerHTML = `<h1>My account</h1>${needLogin('see your account')}`; bindLogin($app); return; }
  const u = state.user, m = state.me || {};
  const name = u.user_metadata?.full_name || m.display_name || u.email;
  const until = m.member_until ? new Date(m.member_until).toLocaleDateString() : '';
  const tile = (href, ic, t, d) => `<a class="acc-tile" href="${href}"><span class="acc-ic">${ic}</span><span><b>${t}</b><br><span class="muted">${d}</span></span><span class="chev">›</span></a>`;
  $app.innerHTML = `<div class="acc-head">${avatarHtml('lg')}
      <div class="grow"><h1 style="margin:0">${esc(name)}</h1><div class="muted">${esc(u.email || '')}</div>
        <div class="row tight" style="margin-top:.5rem"><button class="btn sec sm-btn" id="pic">📷 Change photo</button>${isCustomAvatar() ? '<button class="btn sec sm-btn" id="pic-rm">Remove</button>' : ''}</div>
        <input type="file" id="pic-f" accept="image/*" hidden>
</div></div>
    <div class="acc-list">
      ${tile('#/settings', '⚙️', 'Settings', 'Name, WhatsApp, exchange rate, images')}
      ${tile('#/report', '🛟', 'Report a problem', 'Tell us what went wrong, add a screenshot')}
      ${state.me?.is_admin ? tile('#/admin', '🛡️', 'Admin', 'Users, listings and reports') : ''}
    </div>
    <p style="margin-top:1rem"><button class="btn sec" id="so">Sign out</button></p>`;
  $app.querySelector('#so').onclick = signOut;
  const refresh = () => window.dispatchEvent(new HashChangeEvent('hashchange'));   // redraw the page and the top-bar picture
  const f = $app.querySelector('#pic-f');
  $app.querySelector('#pic').onclick = () => f.click();
  f.onchange = guard(async () => { const file = f.files[0]; f.value = ''; if (!file) return; toast('Uploading photo…'); await changeAvatar(file); toast('Profile photo updated'); refresh(); });
  const rm = $app.querySelector('#pic-rm');
  if (rm) rm.onclick = guard(async () => { await removeAvatar(); toast('Photo removed'); refresh(); });
}
