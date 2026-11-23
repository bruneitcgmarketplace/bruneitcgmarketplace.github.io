import './style.css';
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

function renderChrome(page) {
  const cur = menuKey(page), signed = !!state.user;
  const items = MENU.filter((m) => signed || !m[4]);
  if (state.me?.is_admin) items.push(['admin', '🛡️', 'Admin', '#/admin']);
  const name = state.user?.user_metadata?.full_name || state.user?.email || '';
  $drawer.innerHTML = `<div class="dr-head"><span class="brand">🏴‍☠️ Brunei TCG</span><button class="dr-x" id="dr-x" aria-label="Close menu">✕</button></div>
    ${signed ? `<div class="dr-user"><b>${esc(name)}</b><span class="muted">${isMember() ? '⭐ Member' : 'Free plan'}</span></div>` : ''}
    <nav class="dr-list">${items.map(([k, ic, lb, href]) => `<a class="${cur === k ? 'on' : ''}" href="${href}"><span class="ic">${ic}</span>${lb}</a>`).join('')}</nav>
    <div class="dr-foot">${signed ? `<button class="btn sec" id="dr-out">Sign out</button>` : `<button class="btn" id="dr-in">Sign in with Google</button>`}</div>`;
  $drawer.querySelectorAll('a').forEach((a) => (a.onclick = closeMenu));
  $drawer.querySelector('#dr-x').onclick = closeMenu;
  const o = $drawer.querySelector('#dr-out'); if (o) o.onclick = () => { closeMenu(); signOut(); };
  const i = $drawer.querySelector('#dr-in'); if (i) i.onclick = () => { closeMenu(); signIn(); };
  const titles = { home: 'Brunei TCG', market: 'Marketplace', explore: 'Card sets', sell: 'Sell a card', mylistings: 'My listings', inventory: 'Inventory', scan: 'Scan', orders: 'Orders', membership: 'Membership', settings: 'Settings', admin: 'Admin' };
  $top.innerHTML = `<button class="menu-btn" id="menu-btn" aria-label="Open menu">☰</button>
    <a class="brand" href="#/">${cur === 'home' ? '🏴‍☠️ Brunei TCG' : esc(titles[cur] || 'Brunei TCG')}</a><span class="grow"></span>
    ${signed ? `<a class="btn sec sm-btn" href="#/sell">+ Sell</a>${isMember() ? '<span class="badge warn">⭐ Member</span>' : ''}` : `<button class="btn sm-btn" id="top-login">Sign in</button>`}`;
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
  sb.auth.onAuthStateChange(async (_e, session) => {
    const changed = (session?.user?.id || null) !== (state.user?.id || null);
    state.user = session?.user || null;
    if (changed) { await loadMe(); route(); }
  });
  route();
}
boot();
