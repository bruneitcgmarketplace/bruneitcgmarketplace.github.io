// Public "Sold cards" board: recent sales with the final price. Names are masked on the server (public_sold in 18_public_sold.sql).
import { sb, state, esc, bnd, loadCatalog, upImg, catImg } from '../lib.js';
import { cleanName } from '../receipt.js';
import { cardFilter } from './exploreSets.js';

const PERIODS = { all: 'All time', 7: 'Last 7 days', 30: 'Last 30 days' };
const TYPES = { all: 'All types', buy_now: 'Buy now', auction: 'Auction' };
const SORTS = { new: 'Newest sold', old: 'Oldest sold', high: 'Price high', low: 'Price low' };
const PAGE = 60;
const day = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Brunei', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
const opts = (m, cur) => Object.entries(m).map(([k, v]) => `<option value="${k}"${String(k) === String(cur) ? ' selected' : ''}>${v}</option>`).join('');

async function loadAll() {
  const out = [];
  for (let off = 0; off < 5000; off += 1000) {
    const { data, error } = await sb.rpc('public_sold', { p_limit: 1000, p_offset: off });
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return out;
}

export async function viewSold($app) {
  await loadCatalog();
  const cat = state.cat;
  const saved = JSON.parse(sessionStorage.getItem('sdf') || '{}');
  let per = saved.per || 'all', typ = saved.typ || 'all', sort = saved.sort || 'new', view = localStorage.getItem('view_sold') || 'grid';
  let rows = [], shown = PAGE;
  $app.innerHTML = `<div class="head" style="margin-bottom:.2rem"><h1 style="margin:0">Sold cards</h1><button class="btn sec" id="sr" aria-label="Refresh">↻</button></div>
    <p class="muted" style="margin:.2rem 0 .6rem">Recent sales on the marketplace with the final price. Names are partly hidden.</p>
    <div class="mbar"><input id="q" type="search" placeholder="Search code, name, seller or buyer"><button class="btn sec" id="fb">⚙ Filters</button></div>
    <div class="row tight" style="margin-bottom:.6rem;flex-wrap:wrap"><select id="per" style="flex:1;min-width:6.5rem" aria-label="Period">${opts(PERIODS, per)}</select><select id="typ" style="flex:1;min-width:6.5rem" aria-label="Sale type">${opts(TYPES, typ)}</select><select id="srt" style="flex:1;min-width:6.5rem" aria-label="Sort by">${opts(SORTS, sort)}</select>
      <div class="vsw" id="vsw" role="group" aria-label="View"><button data-v="list" title="List" aria-label="List view">☰</button><button data-v="grid" title="Grid" aria-label="Grid view">▦</button><button data-v="tiles" title="Tiles" aria-label="Tiles view">▪▪▪</button></div></div>
    <p class="muted" id="cnt"></p><div id="list" class="grid"><p class="muted">Loading…</p></div><div id="more" style="text-align:center;margin:.8rem 0"></div>`;
  const $ = (s) => $app.querySelector(s);
  const cf = cardFilter('sdfx', cat, () => paint(true));
  const save = () => sessionStorage.setItem('sdf', JSON.stringify({ per, typ, sort }));
  const imgOf = (r) => { const c = cat.byRef.get(r.card_ref); return r.photo || upImg(r.catalog_image, '250_350') || (c ? catImg(c) : ''); };
  const nameOf = (r) => cleanName(cat.byRef.get(r.card_ref)?.name || r.card_name, r.card_code);
  const badge = (r) => `<span class="badge ${r.type === 'auction' ? 'auc' : 'bn'}">${r.type === 'auction' ? 'Auction' : 'Buy now'}</span>`;
  const diff = (r) => (Number(r.price) !== Number(r.listing_price) ? ` · listed ${bnd(r.listing_price)}` : '');
  const item = (r) => {
    const img = `<img loading="lazy" decoding="async" src="${esc(imgOf(r))}" alt="${esc(r.card_code)}" onerror="this.style.visibility='hidden'">`;
    const who = `${esc(r.seller_name)} → ${esc(r.buyer_name)}`;
    if (view === 'list') return `<div class="lrow">${img}<div class="lb"><div class="lt"><b>${esc(r.card_code)}</b> ${esc(r.rarity || '')} · ${esc(r.condition)}</div><div class="ln">${esc(nameOf(r))}</div><div class="lm">${who} · ${esc(day(r.sold_at))}</div></div><div class="lp"><span class="price">${bnd(r.price)}</span>${badge(r)}</div></div>`;
    return `<div class="tile">${img}<div class="b"><div class="code">${esc(r.card_code)} · ${esc(r.rarity || '')} · ${esc(r.condition)}</div><div class="nm">${esc(nameOf(r))}</div><div class="row tight between"><span class="price">${bnd(r.price)}</span>${badge(r)}</div><div class="muted" style="font-size:.7rem;overflow-wrap:anywhere">${who}</div><div class="muted" style="font-size:.7rem">${esc(day(r.sold_at))}${diff(r)}</div></div></div>`;
  };
  function filtered() {
    const t = $('#q').value.trim().toLowerCase(), now = Date.now();
    let list = rows.filter((r) => {
      if (typ !== 'all' && r.type !== typ) return false;
      if (per !== 'all' && now - new Date(r.sold_at).getTime() > Number(per) * 864e5) return false;
      if (t && !`${r.card_code} ${nameOf(r)} ${r.seller_name} ${r.buyer_name} ${r.rarity || ''}`.toLowerCase().includes(t)) return false;
      return true;
    });
    if (cf.on()) { const ok = cf.pass(new Set(list.map((r) => r.card_ref).filter(Boolean))); list = list.filter((r) => ok.has(r.card_ref)); }
    const t0 = (r) => new Date(r.sold_at).getTime();
    list.sort(sort === 'old' ? (a, b) => t0(a) - t0(b) : sort === 'high' ? (a, b) => b.price - a.price || t0(b) - t0(a) : sort === 'low' ? (a, b) => a.price - b.price || t0(b) - t0(a) : (a, b) => t0(b) - t0(a));
    return list;
  }
  function paint(reset) {
    if (reset) shown = PAGE;
    const list = filtered(), el = $('#list');
    el.className = view === 'list' ? 'lrows' : view === 'tiles' ? 'grid tiles' : 'grid';
    $app.querySelectorAll('#vsw button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
    const fb = $('#fb'); fb.textContent = cf.label(); fb.className = 'btn ' + (cf.on() ? '' : 'sec');
    $('#cnt').textContent = rows.length ? `${list.length} sold${list.length !== rows.length ? ` of ${rows.length}` : ''}` : '';
    el.innerHTML = list.length ? list.slice(0, shown).map(item).join('') : `<p class="muted">${rows.length ? 'Nothing matches these filters.' : 'No sales yet.'}</p>`;
    const more = $('#more');
    more.innerHTML = list.length > shown ? `<button class="btn sec" id="mm">Show more (${list.length - shown} left)</button>` : '';
    if (list.length > shown) $('#mm').onclick = () => { shown += PAGE; paint(); };
  }
  $('#q').oninput = () => paint(true);
  $('#per').onchange = (e) => { per = e.target.value; save(); paint(true); };
  $('#typ').onchange = (e) => { typ = e.target.value; save(); paint(true); };
  $('#srt').onchange = (e) => { sort = e.target.value; save(); paint(true); };
  $app.querySelectorAll('#vsw button').forEach((b) => (b.onclick = () => { view = b.dataset.v; localStorage.setItem('view_sold', view); paint(); }));
  $('#fb').onclick = () => cf.open(() => { const keep = new Set(rows.map((r) => r.card_ref).filter(Boolean)); const ok = cf.pass(keep); return rows.filter((r) => !cf.on() || ok.has(r.card_ref)).length; });
  const reload = async () => {
    try { rows = await loadAll(); await cf.ensure(); paint(true); }
    catch (e) { $('#list').innerHTML = `<div class="notice err">Sold cards could not load. ${esc(e.message || e)}</div>`; }
  };
  $('#sr').onclick = reload;
  await reload();
}
