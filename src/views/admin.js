import { sb, state, esc, guard, rpc, toast, needLogin, bindLogin, PRICE, BANK, isMember, TAGS, sheet, promptSheet, confirmSheet } from '../lib.js';

export async function viewMembership($app) {
  if (!state.user) { $app.innerHTML = `<h1>Membership</h1>${needLogin('see membership')}`; return bindLogin($app); }
  const { data: reqs } = await sb.from('membership_requests').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(5);
  const pending = reqs?.some((r) => r.status === 'pending');
  $app.innerHTML = `<h1>Membership</h1>
    <div class="panel"><p>${isMember() ? `⭐ Active until <b>${new Date(state.me.member_until).toLocaleDateString()}</b>` : 'Free plan'}</p>
    <table><tr><th></th><th>Free</th><th>Member (BND ${esc(PRICE)}/month)</th></tr>
      <tr><td>Sell with Buy now</td><td>✅</td><td>✅</td></tr>
      <tr><td>Buy and bid in auctions</td><td>✅</td><td>✅</td></tr>
      <tr><td>Sell by auction</td><td>🔒</td><td>✅</td></tr></table></div>
    ${BANK ? `<div class="panel"><h2>How to pay</h2>
      <p>1. Transfer BND ${esc(PRICE)} to: <b>${esc(BANK)}</b></p>
      <p>2. Enter your transfer reference below. We approve it manually, usually within a day, and add 30 days.</p>
      ${pending ? '<div class="notice">Your request is pending approval.</div>' : `<input id="ref" placeholder="Bank transfer reference"><p><button class="btn" id="req">Submit payment reference</button></p>`}</div>`
      : `<div class="panel"><h2>Payments opening soon</h2><p class="muted">Membership payment details are not published yet. Check back soon.</p></div>`}
    ${reqs?.length ? `<h2>Your requests</h2><table>${reqs.map((r) => `<tr><td>${esc(r.reference)}</td><td>${esc(r.status)}</td><td class="muted">${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}</table>` : ''}`;
  const b = $app.querySelector('#req');
  if (b) b.onclick = guard(async () => { await rpc('request_membership', { p_reference: $app.querySelector('#ref').value }); toast('Submitted'); viewMembership($app); });
}

export async function viewAdmin($app) {
  if (!state.me?.is_admin) { $app.innerHTML = '<div class="notice err">Admin only</div>'; return; }
  const [reqs, reps] = await Promise.all([
    sb.from('membership_requests').select('*, user:profiles!membership_requests_user_id_fkey(display_name)').eq('status', 'pending').order('created_at'),
    sb.from('reports').select('*, reporter:profiles!reports_reporter_id_fkey(display_name)').eq('resolved', false).order('created_at'),
  ]);
  const { count: openProblems } = await sb.from('problem_reports').select('id', { count: 'exact', head: true }).neq('status', 'resolved');
  $app.innerHTML = `<h1>Admin</h1><p><a class="btn ${openProblems ? '' : 'sec'}" href="#/problems">🛠 Problem reports${openProblems ? ` (${openProblems} open)` : ''}</a></p><h2>Pending memberships</h2>
    ${reqs.data?.length ? `<table>${reqs.data.map((r) => `<tr><td>${esc(r.user?.display_name)}</td><td>${esc(r.reference)}</td><td>
      <button class="btn ok" data-ap="${r.id}">Approve 30d</button> <button class="btn sec" data-rj="${r.id}">Reject</button></td></tr>`).join('')}</table>` : '<p class="muted">None</p>'}
    <h2 style="margin-top:1.2rem">Open reports</h2>
    ${reps.data?.length ? `<table>${reps.data.map((r) => `<tr><td><a href="#/listing/${r.listing_id}">listing</a></td><td>${esc(r.reason)}<br><span class="muted">by ${esc(r.reporter?.display_name)}</span></td><td>
      <button class="btn bad" data-cl="${r.listing_id}" data-rp="${r.id}">Cancel listing</button> <button class="btn sec" data-rs="${r.id}">Dismiss</button></td></tr>`).join('')}</table>` : '<p class="muted">None</p>'}
    <h2 style="margin-top:1.2rem">Users</h2><div id="usec"></div>`;
  const bind = (attr, fn) => $app.querySelectorAll(`[${attr}]`).forEach((b) => (b.onclick = guard(async () => { await fn(b); viewAdmin($app); })));
  bind('data-ap', (b) => rpc('admin_approve_membership', { p_request: Number(b.dataset.ap), p_days: 30 }));
  bind('data-rj', (b) => rpc('admin_reject_membership', { p_request: Number(b.dataset.rj) }));
  bind('data-cl', (b) => rpc('admin_cancel_listing', { p_listing: b.dataset.cl, p_report: Number(b.dataset.rp) }));
  bind('data-rs', (b) => rpc('admin_resolve_report', { p_report: Number(b.dataset.rs) }));
  mountUsers($app.querySelector('#usec'));
}

// ---------- users: search, filters and moderation ----------
const UF0 = { q: '', status: 'all', plan: 'all', role: 'all', tag: 'all', sort: 'new' };
const openIds = new Set();
const isSusp = (u) => u.suspended_until && new Date(u.suspended_until) > new Date();
const statusOf = (u) => (u.banned ? 'banned' : isSusp(u) ? 'suspended' : u.strikes >= 3 ? 'blocked' : 'active');
const isMem = (u) => u.member_until && new Date(u.member_until) > new Date();
const fmtD = (d) => new Date(d).toLocaleDateString();

async function fetchUsers() {
  const [u, t, r] = await Promise.all([
    sb.from('private_profiles').select('id, strikes, member_until, is_admin, whatsapp, banned, banned_reason, suspended_until, suspended_reason, profile:profiles!private_profiles_id_fkey(display_name, created_at)').limit(5000),
    sb.from('user_tags').select('user_id, tag').limit(10000),
    sb.from('rating_summary').select('ratee_id, avg, n').limit(10000),
  ]);
  if (u.error) throw new Error(u.error.message);
  const tags = new Map(), rate = new Map();
  for (const x of t.data || []) (tags.get(x.user_id) || tags.set(x.user_id, new Set()).get(x.user_id)).add(x.tag);
  for (const x of r.data || []) rate.set(x.ratee_id, { avg: Number(x.avg), n: x.n });
  return (u.data || []).map((x) => ({ ...x, name: x.profile?.display_name || 'User', joined: x.profile?.created_at || '', tags: tags.get(x.id) || new Set(), rating: rate.get(x.id) || { avg: 0, n: 0 } }));
}

async function mountUsers(el) {
  const uf = Object.assign({}, UF0, JSON.parse(sessionStorage.getItem('uf') || '{}'));
  let users = [];
  el.innerHTML = '<div class="loading">Loading users…</div>';
  try { users = await fetchUsers(); } catch (e) { el.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }

  const sel = (id, label, opts) => `<select id="${id}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}" ${uf[id.slice(2)] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="ufilters">
      <input id="uq" type="search" placeholder="Search name or WhatsApp number" value="${esc(uf.q)}">
      <div class="ugrid">
        ${sel('u-status', 'Status', [['all', 'Status: all'], ['active', 'Active'], ['suspended', 'Suspended'], ['banned', 'Banned'], ['strikes', 'Has strikes'], ['blocked', 'Blocked (3+ strikes)']])}
        ${sel('u-plan', 'Plan', [['all', 'Plan: all'], ['member', 'Members'], ['free', 'Free']])}
        ${sel('u-role', 'Role', [['all', 'Role: all'], ['admin', 'Admins'], ['user', 'Regular users']])}
        ${sel('u-tag', 'Badge', [['all', 'Badge: all'], ['any', 'Any badge'], ['none', 'No badge'], ...Object.entries(TAGS)])}
        ${sel('u-sort', 'Sort', [['new', 'Newest first'], ['old', 'Oldest first'], ['name', 'Name A to Z'], ['strikes', 'Most strikes'], ['rating', 'Best rated']])}
        <button class="btn sec" id="ureset">Reset</button></div>
      <div class="muted" id="ucount"></div></div>
    <div id="ulist"></div>`;
  const $ = (s) => el.querySelector(s);

  const match = (u) => {
    const q = uf.q.trim().toLowerCase();
    if (q && !(u.name.toLowerCase().includes(q) || (u.whatsapp || '').includes(q.replace(/\D/g, '') || '\u0000'))) return false;
    const s = statusOf(u);
    if (uf.status === 'strikes' ? u.strikes < 1 : uf.status === 'blocked' ? !(u.strikes >= 3) : uf.status !== 'all' && s !== uf.status) return false;
    if (uf.plan === 'member' && !isMem(u)) return false; if (uf.plan === 'free' && isMem(u)) return false;
    if (uf.role === 'admin' && !u.is_admin) return false; if (uf.role === 'user' && u.is_admin) return false;
    if (uf.tag === 'any' ? !u.tags.size : uf.tag === 'none' ? u.tags.size : uf.tag !== 'all' && !u.tags.has(uf.tag)) return false;
    return true;
  };
  const order = { new: (a, b) => b.joined.localeCompare(a.joined), old: (a, b) => a.joined.localeCompare(b.joined), name: (a, b) => a.name.localeCompare(b.name), strikes: (a, b) => b.strikes - a.strikes || a.name.localeCompare(b.name), rating: (a, b) => (b.rating.n ? b.rating.avg : -1) - (a.rating.n ? a.rating.avg : -1) || b.rating.n - a.rating.n };

  const chip = (u) => {
    const s = statusOf(u), c = [];
    if (u.is_admin) c.push('<span class="badge warn">admin</span>');
    if (s === 'banned') c.push('<span class="ust bad">Banned</span>');
    else if (s === 'suspended') c.push(`<span class="ust warn">Suspended to ${esc(fmtD(u.suspended_until))}</span>`);
    else if (s === 'blocked') c.push('<span class="ust warn">Blocked: 3 strikes</span>');
    return c.join(' ');
  };
  const card = (u) => {
    const s = statusOf(u);
    return `<div class="ucard ${s !== 'active' ? 'is-' + s : ''}" data-id="${u.id}">
      <div class="uh"><a href="#/user/${u.id}"><b>${esc(u.name)}</b></a> ${chip(u)}</div>
      <div class="um"><span class="muted">joined ${u.joined ? esc(fmtD(u.joined)) : '?'}</span> · ${isMem(u) ? '⭐ ' + esc(fmtD(u.member_until)) : 'Free'}${u.rating.n ? ` · <span class="stars">★ ${u.rating.avg.toFixed(1)}</span> <span class="muted">(${u.rating.n})</span>` : ''}</div>
      <div class="ur"><span class="muted">Strikes</span><span class="stepper"><button data-do="strike-" aria-label="Remove a strike" ${u.is_admin || !u.strikes ? 'disabled' : ''}>−</button><b>${u.strikes}</b><button data-do="strike+" aria-label="Add a strike" ${u.is_admin ? 'disabled' : ''}>+</button></span>
        ${[...u.tags].length ? `<span class="tagline">${[...u.tags].map((k) => `<span class="utag t-${k}">${esc(TAGS[k] || k)}</span>`).join(' ')}</span>` : ''}</div>
      <details ${openIds.has(u.id) ? 'open' : ''}><summary>Manage</summary>
        <div class="tagbtns">${Object.entries(TAGS).map(([k, l]) => `<button class="fc ${u.tags.has(k) ? 'on' : ''}" data-do="tag" data-k="${k}" data-on="${u.tags.has(k) ? 0 : 1}">${esc(l)}</button>`).join('')}</div>
        <div class="uact"><button class="btn sec sm-btn" data-do="grant">+30d member</button><button class="btn sec sm-btn" data-do="revoke">Revoke member</button></div>
        ${u.is_admin ? '<p class="muted">Admins cannot be suspended, banned or deleted. Remove admin rights first.</p>' : `<div class="uact">
          ${isSusp(u) ? '<button class="btn sec sm-btn" data-do="unsuspend">Lift suspension</button>' : '<button class="btn warnb sm-btn" data-do="suspend">Suspend…</button>'}
          ${u.banned ? '<button class="btn sec sm-btn" data-do="unban">Unban</button>' : '<button class="btn bad sm-btn" data-do="ban">Ban…</button>'}
          <button class="btn bad sm-btn" data-do="delete">Delete…</button></div>
          ${u.banned && u.banned_reason ? `<p class="muted">Ban reason: ${esc(u.banned_reason)}</p>` : ''}${isSusp(u) && u.suspended_reason ? `<p class="muted">Suspension reason: ${esc(u.suspended_reason)}</p>` : ''}`}
      </details></div>`;
  };

  const draw = () => {
    sessionStorage.setItem('uf', JSON.stringify(uf));
    const rows = users.filter(match).sort(order[uf.sort] || order.new);
    $('#ucount').textContent = `Showing ${Math.min(rows.length, 100)} of ${users.length} user${users.length === 1 ? '' : 's'}${rows.length !== users.length ? ` (${rows.length} match)` : ''}`;
    $('#ulist').innerHTML = rows.slice(0, 100).map(card).join('') || '<p class="muted">No users match.</p>';
    el.querySelectorAll('.ucard details').forEach((d) => (d.ontoggle = () => { const id = d.closest('.ucard').dataset.id; d.open ? openIds.add(id) : openIds.delete(id); }));
    el.querySelectorAll('.ucard [data-do]').forEach((b) => (b.onclick = guard(async () => { await act(b.closest('.ucard').dataset.id, b); })));
  };
  const reload = async () => { users = await fetchUsers(); draw(); };

  const suspendSheet = (name) => new Promise((res) => {
    const s = sheet(`<h2>Suspend ${esc(name)}</h2><p class="muted">They can browse but cannot list, buy, bid, rate or change their collection until the date. Their active listings are cancelled.</p>
      <label>Length</label><select id="sp-d">${[[1, '1 day'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']].map(([v, l]) => `<option value="${v}" ${v === 7 ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Reason (shown to the user)</label><textarea id="sp-r" rows="2" maxlength="200"></textarea>
      <div class="row tight" style="margin-top:.6rem"><button class="btn warnb" id="sp-ok">Suspend</button><button class="btn sec" id="sp-no">Cancel</button></div>`);
    s.el.querySelector('#sp-no').onclick = () => s.close();
    s.el.querySelector('#sp-ok').onclick = () => { res({ days: Number(s.el.querySelector('#sp-d').value), reason: s.el.querySelector('#sp-r').value }); s.close(); };
  });

  async function act(id, b) {
    const u = users.find((x) => x.id === id), a = b.dataset.do;
    if (a === 'strike+' || a === 'strike-') await rpc('admin_adjust_strikes', { p_user: id, p_delta: a === 'strike+' ? 1 : -1, p_reason: null });
    else if (a === 'tag') await rpc('set_user_tag', { p_user: id, p_tag: b.dataset.k, p_on: b.dataset.on === '1' });
    else if (a === 'grant') await rpc('admin_grant_membership', { p_user: id, p_days: 30 });
    else if (a === 'revoke') { if (!(await confirmSheet('Revoke membership?', `${u.name} goes back to the free plan.`, 'Revoke', true))) return; await rpc('admin_grant_membership', { p_user: id, p_days: 0 }); }
    else if (a === 'suspend') { const r = await suspendSheet(u.name); await rpc('admin_suspend', { p_user: id, p_days: r.days, p_reason: r.reason }); toast(`${u.name} suspended for ${r.days} day${r.days === 1 ? '' : 's'}`); }
    else if (a === 'unsuspend') { await rpc('admin_unsuspend', { p_user: id }); toast('Suspension lifted'); }
    else if (a === 'ban') { const reason = await promptSheet(`Ban ${u.name}`, 'Reason (shown to the user)', { okLabel: 'Ban user', multiline: true }); await rpc('admin_ban', { p_user: id, p_reason: reason }); toast(`${u.name} banned`); }
    else if (a === 'unban') { if (!(await confirmSheet('Unban user?', `${u.name} can use the site again.`, 'Unban'))) return; await rpc('admin_unban', { p_user: id }); toast('User unbanned'); }
    else if (a === 'delete') {
      if (!(await confirmSheet(`Delete ${u.name}?`, 'A user with no trading history is removed completely. A user with listings, bids or reports is anonymised and stays permanently blocked, so other people keep their order history. This cannot be undone.', 'Delete user', true))) return;
      const r = await rpc('admin_delete_user', { p_user: id }); toast(r === 'deleted' ? 'User deleted' : 'User anonymised and blocked (their trading history is kept)');
    }
    await reload();
  }

  $('#uq').oninput = () => { uf.q = $('#uq').value; clearTimeout(mountUsers.t); mountUsers.t = setTimeout(draw, 200); };
  ['status', 'plan', 'role', 'tag', 'sort'].forEach((k) => ($('#u-' + k).onchange = () => { uf[k] = $('#u-' + k).value; draw(); }));
  $('#ureset').onclick = () => { Object.assign(uf, UF0); $('#uq').value = ''; ['status', 'plan', 'role', 'tag', 'sort'].forEach((k) => ($('#u-' + k).value = UF0[k])); draw(); };
  draw();
}
