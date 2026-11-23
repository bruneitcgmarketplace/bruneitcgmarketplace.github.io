import './style.css';
import './theme.css';
import { initLightbox } from './lightbox.js';
import { viewCart } from './views/cart.js';
import { viewAccount } from './views/account.js';
import { cartIds } from './cart.js';
import { sb, configured, state, esc, loadMe, loadFx, loadCatalog, signIn, signOut, isMember, fmtLeft, initHd, avatarHtml } from './lib.js';
import { viewShared } from './views/shared.js';
import { viewHome } from './views/home.js';
import { viewInventory } from './views/inventory.js';
import { viewExplore, viewMarket, viewSet, viewCard } from './views/explore.js';
import { viewScan, stopScan } from './views/scan.js';
import { viewOrders } from './views/orders.js';
import { viewSettings } from './views/settings.js';
import { viewListing } from './views/listing.js';
import { viewSell } from './views/sell.js';
import { viewMembership, viewAdmin } from './views/admin.js';

const $app = document.getElementById('app');
const $top = document.getElementById('top');

// countdown timers (any element with data-end)
setInterval(() => {
  document.querySelectorAll('.timer[data-end]').forEach((el) => {
    const ms = new Date(el.dataset.end) - Date.now();
    el.textContent = fmtLeft(ms);
    el.classList.toggle('soon', ms > 0 && ms < 3600e3);
    if (ms <= 0 && el.dataset.fired !== '1' && el.dataset.reload) { el.dataset.fired = '1'; setTimeout(route, 1500); }
  });
}, 1000);

// Menu bar (top of every page). Each item: [key, icon, label, href, needsLogin?]. Account and cart live top right.
const MENU = [
  ['home', '🏠', 'Home', '#/'],
  ['market', '🛒', 'Marketplace', '#/market'],
  ['explore', '🧭', 'Explore', '#/explore'],
  ['sell', '➕', 'Sell', '#/sell'],
  ['inventory', '📦', 'My collection', '#/inventory'],
  ['scan', '📷', 'Scan', '#/scan'],
];
// My listings, Orders, Membership, Settings and Admin live under My account (top right), not in this bar
const menuKey = (page) => ({ listing: 'market', set: 'explore', card: 'explore', mylistings: 'account', orders: 'account', membership: 'account', settings: 'account', admin: 'account', shared: 'inventory' }[page] || page || 'home');
const ICON = {
  user: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.5l2.2 11h10.1l2-8H6.4"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
};
window.addEventListener('cart-changed', () => { const el = document.getElementById('cart-n'); if (!el) return; const n = state.user ? cartIds().length : 0; el.textContent = n; el.hidden = !n; });

function renderChrome(page) {
  const cur = menuKey(page), signed = !!state.user;
  const items = MENU;
  const n = signed ? cartIds().length : 0;
  $top.innerHTML = `<div class="top-row">
      <a class="brand" href="#/"><img class="flag" src="./flag.svg" alt="Brunei" width="40" height="27"><span class="op" aria-label="One Piece TCG"><span>One P</span><svg viewBox="0 0 10 22" aria-hidden="true"><g fill="#e3202f" stroke="#0b1c4d" stroke-width=".7" stroke-linejoin="round"><circle cx="5" cy="3.1" r="2.6"/><path d="M2 7h6l1.4 6.6h-2V21H5.6v-5.2h-1.2V21H2.6v-7.4h-2z"/></g></svg><span>ece</span>&nbsp;<span>TCG</span></span></a><span class="grow"></span>
      <a class="ic-btn ${cur === 'account' ? 'on' : ''}" href="#/account" aria-label="My account" title="My account">${signed ? avatarHtml('sm') : ICON.user}</a>
      <a class="ic-btn ${cur === 'cart' ? 'on' : ''}" href="#/cart" aria-label="View my cart" title="My cart">${ICON.cart}<span class="cart-n" id="cart-n" ${n ? '' : 'hidden'}>${n}</span></a>
    </div>
    <nav class="menu-bar" id="menu-bar">${items.map(([k, ic, lb, href]) => `<a class="${cur === k ? 'on' : ''}" href="${href}"><span class="ic">${ic}</span>${lb}</a>`).join('')}</nav>`;
  const on = $top.querySelector('.menu-bar a.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}

let unsub = null, seq = 0;
async function route() {
  const my = ++seq;
  if (unsub) { unsub(); unsub = null; }
  stopScan();
  const [path] = location.hash.slice(2).split('?');
  const [page, arg] = path.split('/');
  renderChrome(page);
  window.scrollTo(0, 0);
  if (!configured) { $app.innerHTML = `<div class="panel"><h1>Setup needed</h1><p>Add the Supabase keys (see README), then rebuild.</p></div>`; return; }
  const ok = () => my === seq; // drop stale async renders
  try {
    const target = document.createElement('div'); // per-route container: a slow stale render can't overwrite the current page
    $app.replaceChildren(target);
    switch (page) {
      case 'inventory': await viewInventory(target); break;
      case 'explore': await viewExplore(target); break;
      case 'market': await viewMarket(target); break;
      case 'cart': await viewCart(target); break;
      case 'account': await viewAccount(target); break;
      case 'mylistings': await viewOrders(target, { only: 'selling' }); break;
      case 'set': await viewSet(target, arg); break;
      case 'card': await viewCard(target, decodeURIComponent(arg || '')); break;
      case 'scan': await viewScan(target); break;
      case 'shared': await viewShared(target, arg); break;
      case 'orders': await viewOrders(target); break;
      case 'settings': await viewSettings(target); break;
      case 'listing': await viewListing(target, arg, (fn) => { if (ok()) unsub = fn; else fn(); }); break;
      case 'sell': await viewSell(target, arg); break;
      case 'membership': await viewMembership(target); break;
      case 'admin': await viewAdmin(target); break;
      default: await viewHome(target);
    }
  } catch (e) { if (ok()) $app.innerHTML = `<div class="notice err">${esc(e.message || e)}</div>`; }
}
window.addEventListener('hashchange', route);

async function boot() {
  initHd();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
  if (!configured) return route();
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user || null;
  await Promise.all([loadMe(), loadCatalog(), loadFx()]);
  initLightbox(state.cat.byRef);
  sb.auth.onAuthStateChange(async (_e, session) => {
    const changed = (session?.user?.id || null) !== (state.user?.id || null);
    state.user = session?.user || null;
    if (changed) { await loadMe(); route(); }
  });
  route();
}
boot();
