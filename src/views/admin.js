import { sb, state, esc, guard, rpc, toast, needLogin, bindLogin, PRICE, BANK, isMember } from '../lib.js';

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
  const [reqs, reps, users] = await Promise.all([
    sb.from('membership_requests').select('*, user:profiles!membership_requests_user_id_fkey(display_name)').eq('status', 'pending').order('created_at'),
    sb.from('reports').select('*, reporter:profiles!reports_reporter_id_fkey(display_name)').eq('resolved', false).order('created_at'),
    sb.from('private_profiles').select('id, strikes, member_until, is_admin, profile:profiles!private_profiles_id_fkey(display_name, created_at)').order('id').limit(200),
  ]);
  const { count: openProblems } = await sb.from('problem_reports').select('id', { count: 'exact', head: true }).neq('status', 'resolved');
  const ul = (users.data || []).sort((a, b) => (b.profile?.created_at || '').localeCompare(a.profile?.created_at || ''));
  $app.innerHTML = `<h1>Admin</h1><p><a class="btn ${openProblems ? '' : 'sec'}" href="#/problems">🛠 Problem reports${openProblems ? ` (${openProblems} open)` : ''}</a></p><h2>Pending memberships</h2>
    ${reqs.data?.length ? `<table>${reqs.data.map((r) => `<tr><td>${esc(r.user?.display_name)}</td><td>${esc(r.reference)}</td><td>
      <button class="btn ok" data-ap="${r.id}">Approve 30d</button> <button class="btn sec" data-rj="${r.id}">Reject</button></td></tr>`).join('')}</table>` : '<p class="muted">None</p>'}
    <h2 style="margin-top:1.2rem">Open reports</h2>
    ${reps.data?.length ? `<table>${reps.data.map((r) => `<tr><td><a href="#/listing/${r.listing_id}">listing</a></td><td>${esc(r.reason)}<br><span class="muted">by ${esc(r.reporter?.display_name)}</span></td><td>
      <button class="btn bad" data-cl="${r.listing_id}" data-rp="${r.id}">Cancel listing</button> <button class="btn sec" data-rs="${r.id}">Dismiss</button></td></tr>`).join('')}</table>` : '<p class="muted">None</p>'}
    <h2 style="margin-top:1.2rem">Users (${ul.length})</h2>
    <table>${ul.map((u) => `<tr><td>${esc(u.profile?.display_name)}${u.is_admin ? ' <span class="badge warn">admin</span>' : ''}<br><span class="muted">joined ${u.profile?.created_at ? new Date(u.profile.created_at).toLocaleDateString() : ''}</span></td>
      <td>${u.member_until && new Date(u.member_until) > new Date() ? '⭐ ' + new Date(u.member_until).toLocaleDateString() : 'Free'}<br><span class="muted">strikes ${u.strikes}</span></td>
      <td><button class="btn sec sm-btn" data-gr="${u.id}">+30d</button> <button class="btn sec sm-btn" data-rv="${u.id}">Revoke</button> ${u.strikes ? `<button class="btn sec sm-btn" data-st="${u.id}">Clear strikes</button>` : ''}</td></tr>`).join('')}</table>`;
  const bind = (attr, fn) => $app.querySelectorAll(`[${attr}]`).forEach((b) => (b.onclick = guard(async () => { await fn(b); viewAdmin($app); })));
  bind('data-ap', (b) => rpc('admin_approve_membership', { p_request: Number(b.dataset.ap), p_days: 30 }));
  bind('data-rj', (b) => rpc('admin_reject_membership', { p_request: Number(b.dataset.rj) }));
  bind('data-cl', (b) => rpc('admin_cancel_listing', { p_listing: b.dataset.cl, p_report: Number(b.dataset.rp) }));
  bind('data-rs', (b) => rpc('admin_resolve_report', { p_report: Number(b.dataset.rs) }));
  bind('data-gr', (b) => rpc('admin_grant_membership', { p_user: b.dataset.gr, p_days: 30 }));
  bind('data-rv', (b) => rpc('admin_grant_membership', { p_user: b.dataset.rv, p_days: 0 }));
  bind('data-st', (b) => rpc('admin_set_strikes', { p_user: b.dataset.st, p_strikes: 0 }));
}
