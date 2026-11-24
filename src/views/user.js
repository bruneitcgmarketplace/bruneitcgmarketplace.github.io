// Public seller/buyer page: rating, tags and written reviews.
import { sb, state, esc, toast, guard, rpc, userMeta, starsHtml, tagsHtml } from '../lib.js';

export async function viewUser($app, id) {
  $app.innerHTML = '<div class="loading">Loading…</div>';
  const { data: p } = await sb.from('profiles').select('id, display_name, created_at').eq('id', id).maybeSingle();
  if (!p) { $app.innerHTML = '<div class="notice err">User not found</div>'; return; }
  const [meta, rv, act] = await Promise.all([
    userMeta([id]),
    sb.from('ratings').select('id, stars, comment, created_at, rater:profiles!ratings_rater_id_fkey(display_name)').eq('ratee_id', id).order('created_at', { ascending: false }).limit(100),
    sb.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', id).eq('status', 'active'),
  ]);
  const m = meta.get(id) || { avg: 0, n: 0, tags: [] }, rows = rv.data || [];
  const dist = [5, 4, 3, 2, 1].map((s) => [s, rows.filter((r) => r.stars === s).length]);
  const isAdmin = !!state.me?.is_admin;
  $app.innerHTML = `<p><a href="javascript:history.back()">← Back</a></p>
    <div class="panel"><h1 style="margin:0">${esc(p.display_name)}</h1>
      <div style="margin:.3rem 0">${tagsHtml(m.tags) || '<span class="muted">No tags</span>'}</div>
      <div style="font-size:1.1rem">${starsHtml(m.avg, m.n)}</div>
      <div class="muted">Member since ${new Date(p.created_at).toLocaleDateString()} · ${act.count || 0} active listing${act.count === 1 ? '' : 's'}</div>
      ${rows.length ? `<div class="dist">${dist.map(([s, c]) => `<div><span>${s}★</span><i style="width:${Math.round((c / rows.length) * 100)}%"></i><b>${c}</b></div>`).join('')}</div>` : ''}</div>
    <h2>Reviews</h2>
    ${rows.length ? rows.map((r) => `<div class="panel review"><div class="row tight between"><span class="stars">${'★'.repeat(r.stars)}<span class="off">${'★'.repeat(5 - r.stars)}</span></span><span class="muted">${new Date(r.created_at).toLocaleDateString()}</span></div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<div class="muted">by ${esc(r.rater?.display_name || 'User')}${isAdmin ? ` · <a href="#" data-del="${r.id}">remove</a>` : ''}</div></div>`).join('') : '<p class="muted">No reviews yet. Ratings appear after a deal is marked as sold.</p>'}`;
  $app.querySelectorAll('[data-del]').forEach((a) => (a.onclick = guard(async (e) => { e.preventDefault(); if (!confirm('Remove this review?')) return; await rpc('admin_delete_rating', { p_rating: Number(a.dataset.del) }); toast('Review removed'); viewUser($app, id); })));
}
