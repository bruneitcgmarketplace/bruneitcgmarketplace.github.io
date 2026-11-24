// Admin > Problem reports: read what users sent, open screenshots and files, set a status, reply, WhatsApp the reporter.
import { sb, state, esc, toast, guard, rpc } from '../lib.js';
import { waUrl } from '../receipt.js';
import { CATEGORIES, STATUS } from './report.js';

const TABS = [['open', 'Open'], ['working', 'Being looked at'], ['resolved', 'Resolved'], ['all', 'All']];
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

export async function viewProblems($app) {
  if (!state.me?.is_admin) { $app.innerHTML = '<div class="notice err">Admin only</div>'; return; }
  const tab = sessionStorage.getItem('ptab') || 'open';
  $app.innerHTML = `<p><a href="#/admin">← Admin</a></p><h1>Problem reports</h1>
    <div class="seg" id="pt">${TABS.map(([k, v]) => `<a data-t="${k}" class="${k === tab ? 'on' : ''}">${v}</a>`).join('')}</div><div id="pl"><p class="muted">Loading…</p></div>`;
  $app.querySelectorAll('#pt a').forEach((a) => (a.onclick = () => { sessionStorage.setItem('ptab', a.dataset.t); viewProblems($app); }));
  let q = sb.from('problem_reports').select('*, reporter:profiles!problem_reports_reporter_id_fkey(display_name)').order('created_at', { ascending: false }).limit(100);
  if (tab !== 'all') q = q.eq('status', tab);
  const { data, error } = await q;
  const el = $app.querySelector('#pl');
  if (error) { el.innerHTML = `<div class="notice err">${esc(error.message)}</div>`; return; }
  if (!data.length) { el.innerHTML = `<p class="muted">No ${tab === 'all' ? '' : esc((STATUS[tab] || tab).toLowerCase()) + ' '}reports.</p>`; return; }
  // WhatsApp numbers (admins may read them) and temporary links for the attachments
  const ids = [...new Set(data.map((r) => r.reporter_id))];
  const [{ data: pp }, signed] = await Promise.all([
    sb.from('private_profiles').select('id, whatsapp').in('id', ids),
    Promise.all(data.map(async (r) => (r.files?.length ? (await sb.storage.from('problem-files').createSignedUrls(r.files.map((f) => f.path), 3600)).data || [] : []))),
  ]);
  const wa = new Map((pp || []).map((p) => [p.id, p.whatsapp]));
  el.innerHTML = data.map((r, i) => {
    const urls = signed[i] || [], number = wa.get(r.reporter_id), name = r.reporter?.display_name || 'User';
    const files = (r.files || []).map((f, j) => {
      const u = urls[j]?.signedUrl;
      if (!u) return `<span class="muted">${esc(f.name)} (unavailable)</span>`;
      return f.type?.startsWith('image/')
        ? `<a href="${esc(u)}" data-img="${esc(u)}" data-nm="${esc(f.name)}"><img class="avatar" style="width:88px;height:88px;border-radius:8px;object-fit:cover;cursor:zoom-in" src="${esc(u)}" alt="${esc(f.name)}"></a>`
        : `<a class="btn sec sm-btn" target="_blank" rel="noopener" href="${esc(u)}">📄 ${esc(f.name)} <span class="muted">${fmtSize(f.size || 0)}</span></a>`;
    }).join(' ');
    const cls = r.status === 'resolved' ? 'ok' : r.status === 'working' ? 'warn' : 'bad';
    const reply = `Hi ${name}, about your problem report #${r.id} on One Piece TCG: ${r.admin_note || ''}`.trim();
    return `<div class="panel" data-id="${r.id}"><div class="row tight between"><b>#${r.id} · ${esc(CATEGORIES[r.category] || r.category)}</b><span class="chip ${cls}">${esc(STATUS[r.status] || r.status)}</span></div>
      <div class="muted">${esc(name)} · ${new Date(r.created_at).toLocaleString()}</div>
      <div style="margin:.5rem 0;white-space:pre-wrap">${esc(r.message)}</div>
      ${files ? `<div class="row tight" style="margin:.4rem 0;flex-wrap:wrap">${files}</div>` : ''}
      ${r.device ? `<details><summary class="muted">Device</summary><div class="muted" style="word-break:break-all">${esc(r.device)}</div></details>` : ''}
      <label>Status</label><select data-k="st">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>Reply or note (the reporter sees it under My reports)</label><textarea data-k="note" rows="2" maxlength="1000">${esc(r.admin_note || '')}</textarea>
      <div class="row tight" style="margin-top:.4rem"><button class="btn" data-k="save">Save</button>${number ? `<a class="btn sec" target="_blank" rel="noopener" href="${waUrl(number, reply)}">💬 WhatsApp ${esc(name)}</a>` : '<span class="muted">No WhatsApp number on file</span>'}</div></div>`;
  }).join('');
  el.querySelectorAll('[data-img]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); import('../lightbox.js').then((m) => m.openLightbox([a.dataset.img], 0, [a.dataset.nm])); }));
  el.querySelectorAll('.panel').forEach((p) => {
    p.querySelector('[data-k=save]').onclick = guard(async () => {
      await rpc('admin_update_problem', { p_id: Number(p.dataset.id), p_status: p.querySelector('[data-k=st]').value, p_note: p.querySelector('[data-k=note]').value });
      toast('Saved'); viewProblems($app);
    });
  });
}
