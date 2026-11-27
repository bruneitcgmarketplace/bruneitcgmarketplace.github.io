// Public seller/buyer page: rating, tags and written reviews.
import { sb, state, esc, toast, guard, rpc, userMeta, starsHtml, tagsHtml, fetchAll, groupBuyNow, primeMeta, tile, listRow, listingPrice, loadCatalog, loadInv } from '../lib.js';
import { cardFilter, FRESH } from './exploreSets.js';

export async function viewUser($app, id) {
  $app.innerHTML = '<div class="loading">Loading…</div>';
  const { data: p } = await sb.from('profiles').select('id, display_name, created_at').eq('id', id).maybeSingle();
  if (!p) { $app.innerHTML = '<div class="notice err">User not found</div>'; return; }
  const [meta, rv, act] = await Promise.all([
    userMeta([id]),
    sb.from('ratings').select('id, rater_id, batch, stars, comment, created_at, rater:profiles!ratings_rater_id_fkey(display_name)').eq('ratee_id', id).order('created_at', { ascending: false }).limit(100),
    sb.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', id).eq('status', 'active'),
  ]);
  const live = await fetchAll(() => sb.from('listings').select('*, seller:profiles!listings_seller_id_fkey(display_name)').eq('seller_id', id).or('status.eq.active,and(status.eq.reserved,type.eq.buy_now)').order('created_at', { ascending: false }).order('id'));
  await primeMeta(live);
  const cat = await loadCatalog();
  if (state.user) await loadInv();
  const m = meta.get(id) || { avg: 0, n: 0, tags: [] }, rows = [...new Map((rv.data || []).map((r) => [r.rater_id + r.batch, r])).values()];   // one review per transaction
  const dist = [5, 4, 3, 2, 1].map((s) => [s, rows.filter((r) => r.stars === s).length]);
  const isAdmin = !!state.me?.is_admin;
  $app.innerHTML = `<p><a href="javascript:history.back()">← Back</a></p>
    <div class="panel"><h1 style="margin:0">${esc(p.display_name)}</h1>
      <div style="margin:.3rem 0">${tagsHtml(m.tags) || '<span class="muted">No tags</span>'}</div>
      <div style="font-size:1.1rem">${starsHtml(m.avg, m.n)}</div>
      <div class="muted">Member since ${new Date(p.created_at).toLocaleDateString()} · ${act.count || 0} active listing${act.count === 1 ? '' : 's'}</div>
      ${rows.length ? `<div class="dist">${dist.map(([s, c]) => `<div><span>${s}★</span><i style="width:${Math.round((c / rows.length) * 100)}%"></i><b>${c}</b></div>`).join('')}</div>` : ''}</div>
    <h2 id="uhead">For sale${live.length ? ` (${live.length})` : ''}</h2>
    ${live.length ? `<div class="mbar">
      <input id="uq" type="search" placeholder="Search code or name">
      <button class="btn sec" id="ufbtn">⚙ Filters</button>
      <div class="two"><select id="usort" aria-label="Sort by"><option value="new">Newest</option><option value="low">Price low</option><option value="high">Price high</option></select><div class="vsw" id="uvsw" role="group" aria-label="View"><button data-v="list" title="List" aria-label="List view">☰</button><button data-v="grid" title="Grid" aria-label="Grid view">▦</button><button data-v="tiles" title="Tiles" aria-label="Tiles view">▪▪▪</button></div></div></div>
    ${new Set(live.map((l) => l.kind || 'card')).size > 1 ? `<select id="ukind" aria-label="Item type" class="kindsel"><option value="all">All item types</option>${[...new Set(live.map((l) => l.kind || 'card'))].map((k) => `<option value="${k}">${esc(({ card: 'Single cards', promo: 'Promo / other cards', pack: 'Sealed packs', box: 'Booster boxes', case: 'Cases', slab: 'Graded slabs', other: 'Other items' })[k] || k)}</option>`).join('')}</select>` : ''}
    <div id="ulist" class="grid"></div>` : '<p class="muted">Nothing for sale right now.</p>'}
    <h2>Reviews</h2>
    ${rows.length ? rows.map((r) => `<div class="panel review"><div class="row tight between"><span class="stars">${'★'.repeat(r.stars)}<span class="off">${'★'.repeat(5 - r.stars)}</span></span><span class="muted">${new Date(r.created_at).toLocaleDateString()}</span></div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<div class="muted">by ${esc(r.rater?.display_name || 'User')}${isAdmin ? ` · <a href="#" data-del="${r.id}">remove</a>` : ''}</div></div>`).join('') : '<p class="muted">No reviews yet. Ratings appear after a deal is marked as sold.</p>'}`;
  if (live.length) {
    const PAGE = 50; let page = 0, view = localStorage.getItem('view_mkt') || 'grid';
    const cf = cardFilter('ufx', cat, () => { btnLabel(); paint(); });
    const fbtn = $app.querySelector('#ufbtn'), ul = $app.querySelector('#ulist');
    const btnLabel = () => { fbtn.className = 'btn ' + (cf.on() ? '' : 'sec'); fbtn.textContent = cf.label(); };
    const compute = () => {
      let rows = live; const q = $app.querySelector('#uq').value.trim().toLowerCase();
      const kind = $app.querySelector('#ukind')?.value || 'all';
      if (kind !== 'all') rows = rows.filter((l) => (l.kind || 'card') === kind);
      if (q) rows = rows.filter((l) => `${l.card_code || ''} ${l.card_name || ''} ${cat.byRef.get(l.card_ref)?.en || ''}`.toLowerCase().includes(q));
      if (cf.on()) { const ok = cf.pass(new Set(rows.map((l) => l.card_ref).filter(Boolean))); rows = rows.filter((l) => ok.has(l.card_ref)); }
      const sort = $app.querySelector('#usort').value;
      rows = [...groupBuyNow(rows.filter((l) => l.type === 'buy_now')), ...rows.filter((l) => l.type !== 'buy_now')];
      if (sort === 'low') rows.sort((a, b) => listingPrice(a) - listingPrice(b)); else if (sort === 'high') rows.sort((a, b) => listingPrice(b) - listingPrice(a));
      rows.sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved'));   // held cards last
      return rows;
    };
    function paint(keep) {
      if (!keep) page = 0;
      const rows = compute(), pages = Math.max(1, Math.ceil(rows.length / PAGE)); page = Math.min(page, pages - 1);
      const from = page * PAGE, part = rows.slice(from, from + PAGE);
      ul.className = view === 'list' ? 'lrows' : view === 'tiles' ? 'grid tiles' : 'grid';
      $app.querySelectorAll('#uvsw button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
      $app.querySelector('#uhead').textContent = `For sale (${rows.length}${rows.length === live.length ? '' : ' of ' + live.length})`;
      ul.innerHTML = part.length ? part.map(view === 'list' ? listRow : tile).join('') + (pages > 1 ? `<div class="pager" style="grid-column:1/-1"><button class="btn sec" data-pg="${page - 1}" ${page === 0 ? 'disabled' : ''}>◀ Previous</button><span class="pginfo"><b>Page ${page + 1} of ${pages}</b><small>${from + 1}–${from + part.length} of ${rows.length}</small></span><button class="btn" data-pg="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>Next ▶</button></div>` : '')
        : '<p class="muted">Nothing matches these filters. <a href="#" id="uclr">Clear filters</a></p>';
      ul.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { page = Number(b.dataset.pg); paint(true); $app.querySelector('#uhead').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
      const c = ul.querySelector('#uclr'); if (c) c.onclick = (e) => { e.preventDefault(); sessionStorage.removeItem('ufx'); Object.assign(cf.f, FRESH(), { q: '', sale: false }); $app.querySelector('#uq').value = ''; if ($app.querySelector('#ukind')) $app.querySelector('#ukind').value = 'all'; btnLabel(); paint(); };
    }
    fbtn.onclick = () => cf.open(() => compute().length);
    $app.querySelector('#uq').addEventListener('input', () => paint());
    $app.querySelector('#usort').onchange = () => paint();
    const kd = $app.querySelector('#ukind'); if (kd) kd.onchange = () => paint();
    $app.querySelectorAll('#uvsw button').forEach((b) => (b.onclick = () => { view = b.dataset.v; localStorage.setItem('view_mkt', view); paint(true); }));
    btnLabel(); await cf.ensure(); paint();
  }
  $app.querySelectorAll('[data-del]').forEach((a) => (a.onclick = guard(async (e) => { e.preventDefault(); if (!confirm('Remove this review?')) return; await rpc('admin_delete_rating', { p_rating: Number(a.dataset.del) }); toast('Review removed'); viewUser($app, id); })));
}
