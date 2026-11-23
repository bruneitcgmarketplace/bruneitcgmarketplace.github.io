import './style.css';
import { sb, configured, state, esc, loadMe, loadFx, loadCatalog, signIn, isMember, fmtLeft } from './lib.js';
import { viewHome } from './views/home.js';
import { viewInventory } from './views/inventory.js';
import { viewExplore, viewSet, viewCard } from './views/explore.js';
import { viewScan, stopScan } from './views/scan.js';
import { viewOrders } from './views/orders.js';
import { viewSettings } from './views/settings.js';
import { viewListing } from './views/listing.js';
import { viewSell } from './views/sell.js';
import { viewMembership, viewAdmin } from './views/admin.js';

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
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

const TABS = [['home', '🏠', 'Home'], ['inventory', '📦', 'Inventory'], ['explore', '🧭', 'Explore'], ['scan', '📷', 'Scan'], ['orders', '🧾', 'Orders'], ['settings', '⚙️', 'Settings']];
const tabOf = (page) => ({ set: 'explore', card: 'explore', listing: 'explore', sell: 'inventory', membership: 'settings', admin: 'settings' }[page] || page || 'home');

function renderChrome(page) {
  const cur = tabOf(page);
  $nav.innerHTML = TABS.map(([k, ic, lb]) => `<a class="${cur === k ? 'on' : ''}" href="#/${k === 'home' ? '' : k}"><span class="ic">${ic}</span><span>${lb}</span></a>`).join('');
  $top.innerHTML = `<a class="brand" href="#/">🏴‍☠️ Brunei TCG</a><span class="grow"></span>
    ${state.user ? `<a class="btn sec sm-btn" href="#/sell">+ Sell</a>${isMember() ? '<span class="badge warn">⭐ Member</span>' : ''}` : `<button class="btn sm-btn" id="top-login">Sign in</button>`}`;
  const b = document.getElementById('top-login'); if (b) b.onclick = signIn;
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
