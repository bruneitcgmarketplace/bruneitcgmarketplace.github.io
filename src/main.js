import './style.css';
import { initLightbox } from './lightbox.js';
import { viewCart } from './views/cart.js';
import { viewAccount } from './views/account.js';
import { cartIds } from './cart.js';
import { sb, configured, state, esc, loadMe, loadFx, loadCatalog, signIn, signOut, isMember, fmtLeft, initHd } from './lib.js';
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
const $drawer = document.getElementById('drawer');
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

// Menu (top-left hamburger). Each item: [key, icon, label, href, needsLogin?]
const MENU = [
  ['home', '🏠', 'Home', '#/'],
  ['account', '👤', 'My account', '#/account'],
  ['cart', '🛒', 'My cart', '#/cart'],
  ['market', '🛒', 'Marketplace', '#/market'],
  ['explore', '🧭', 'Card sets', '#/explore'],
  ['sell', '➕', 'Sell a card', '#/sell'],
  ['mylistings', '🏷️', 'My listings', '#/mylistings', true],
  ['inventory', '📦', 'Inventory', '#/inventory'],
  ['scan', '📷', 'Scan cards', '#/scan'],
  ['orders', '🧾', 'Orders', '#/orders', true],
  ['membership', '⭐', 'Membership', '#/membership', true],
  ['settings', '⚙️', 'Settings', '#/settings'],
];
const menuKey = (page) => ({ listing: 'market', set: 'explore', card: 'explore' }[page] || page || 'home');
const closeMenu = () => { document.body.classList.remove('menu-open'); $drawer.setAttribute('aria-hidden', 'true'); };
const openMenu = () => { document.body.classList.add('menu-open'); $drawer.setAttribute('aria-hidden', 'false'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
document.getElementById('scrim').onclick = closeMenu;

const ICON = {
  menu: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.5l2.2 11h10.1l2-8H6.4"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
};
window.addEventListener('cart-changed', () => { const el = document.getElementById('cart-n'); if (!el) return; const n = state.user ? cartIds().length : 0; el.textContent = n; el.hidden = !n; });

function renderChrome(page) {
  const cur = menuKey(page), signed = !!state.user;
  const items = MENU.filter((m) => signed || !m[4]);
  if (state.me?.is_admin) items.push(['admin', '🛡️', 'Admin', '#/admin']);
  const name = state.user?.user_metadata?.full_name || state.user?.email || '';
  $drawer.innerHTML = `<div class="dr-head"><span class="brand"><span class="b1">Brunei TCG</span> <span class="b2">Marketplace</span></span><button class="dr-x" id="dr-x" aria-label="Close menu">✕</button></div>
    ${signed ? `<div class="dr-user"><b>${esc(name)}</b><span class="muted">${isMember() ? '⭐ Member' : 'Free plan'}</span></div>` : ''}
    <nav class="dr-list">${items.map(([k, ic, lb, href]) => `<a class="${cur === k ? 'on' : ''}" href="${href}"><span class="ic">${ic}</span>${lb}</a>`).join('')}</nav>
    <div class="dr-foot">${signed ? `<button class="btn sec" id="dr-out">Sign out</button>` : `<button class="btn" id="dr-in">Sign in with Google</button>`}</div>`;
  $drawer.querySelectorAll('a').forEach((a) => (a.onclick = closeMenu));
  $drawer.querySelector('#dr-x').onclick = closeMenu;
  const o = $drawer.querySelector('#dr-out'); if (o) o.onclick = () => { closeMenu(); signOut(); };
  const i = $drawer.querySelector('#dr-in'); if (i) i.onclick = () => { closeMenu(); signIn(); };
  const n = signed ? cartIds().length : 0;
  const pic = state.user?.user_metadata?.avatar_url || state.user?.user_metadata?.picture;
  $top.innerHTML = `<button class="ic-btn" id="menu-btn" aria-label="Open menu">${ICON.menu}</button>
    <a class="ic-btn ${cur === 'account' ? 'on' : ''}" href="#/account" aria-label="My account">${signed && pic ? `<img class="avatar sm" src="${esc(pic)}" alt="" referrerpolicy="no-referrer">` : ICON.user}</a>
    <a class="ic-btn ${cur === 'cart' ? 'on' : ''}" href="#/cart" aria-label="View my cart">${ICON.cart}<span class="cart-n" id="cart-n" ${n ? '' : 'hidden'}>${n}</span></a>
    <a class="brand" href="#/"><span class="b1">Brunei TCG</span> <span class="b2">Marketplace</span></a>`;
  document.getElementById('menu-btn').onclick = openMenu;
  const b = document.getElementById('top-login'); if (b) b.onclick = signIn;
}

let unsub = null, seq = 0;
async function route() {
  const my = ++seq;
  if (unsub) { unsub(); unsub = null; }
  stopScan();
  const [path] = location.hash.slice(2).split('?');
  const [page, arg] = path.split('/');
  closeMenu();
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
