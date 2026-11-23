import { state, esc, isMember, needLogin, bindLogin, signOut, avatarHtml } from '../lib.js';

export async function viewAccount($app) {
  if (!state.user) { $app.innerHTML = `<h1>My account</h1>${needLogin('see your account')}`; bindLogin($app); return; }
  const u = state.user, m = state.me || {};
  const name = u.user_metadata?.full_name || m.display_name || u.email;
  const until = m.member_until ? new Date(m.member_until).toLocaleDateString() : '';
  const tile = (href, ic, t, d) => `<a class="acc-tile" href="${href}"><span class="acc-ic">${ic}</span><span><b>${t}</b><br><span class="muted">${d}</span></span><span class="chev">›</span></a>`;
  $app.innerHTML = `<div class="acc-head">${avatarHtml('lg')}
      <div class="grow"><h1 style="margin:0">${esc(name)}</h1><div class="muted">${esc(u.email || '')}</div>
      <div style="margin-top:.4rem">${isMember() ? `<span class="badge warn">⭐ Member${until ? ' until ' + until : ''}</span>` : '<span class="badge">Free plan</span> <a href="#/membership">Upgrade to sell by auction</a>'}</div></div></div>
    <div class="acc-list">
      ${tile('#/orders', '🧾', 'Orders', 'What you bought, sold and bid on')}
      ${tile('#/mylistings', '🏷️', 'My listings', 'Active, reserved and ended listings')}
      ${tile('#/membership', '⭐', 'Membership', isMember() ? 'Manage your plan' : 'Unlock auctions for sellers')}
      ${tile('#/settings', '⚙️', 'Settings', 'Name, WhatsApp, exchange rate, images')}
      ${state.me?.is_admin ? tile('#/admin', '🛡️', 'Admin', 'Users, listings and reports') : ''}
    </div>
    <p style="margin-top:1rem"><button class="btn sec" id="so">Sign out</button></p>`;
  $app.querySelector('#so').onclick = signOut;
}
