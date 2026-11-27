// In-app notification inbox (the bell in the top bar). Rows are written by the database when a listing is reserved or sold.
import { sb, state, esc, toast, rpc, needLogin, bindLogin, guard } from '../lib.js';

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
};

export async function viewNotifications($app) {
  if (!state.user) { $app.innerHTML = `<h1>Notifications</h1>${needLogin('see your notifications')}`; bindLogin($app); return; }
  $app.innerHTML = '<h1>Notifications</h1><div class="loading">Loading…</div>';
  const { data, error } = await sb.from('notifications').select('id, title, body, url, created_at, read_at').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (error) { $app.innerHTML = `<h1>Notifications</h1><div class="notice err">${esc(error.message)}</div>`; return; }
  const rows = data || [];
  const unread = rows.filter((r) => !r.read_at).map((r) => r.id);
  $app.innerHTML = `<div class="head"><h1 style="margin:0">Notifications</h1>${rows.length ? '<button class="btn sec" id="nclr">Clear all</button>' : ''}</div>
    ${rows.length ? `<div class="nlist">${rows.map((r) => `<a class="panel nitem ${r.read_at ? '' : 'unread'}" href="${esc(r.url || '#/')}"><div class="row tight between"><b>${esc(r.title)}</b><span class="muted">${ago(r.created_at)}</span></div><div>${esc(r.body)}</div></a>`).join('')}</div>`
      : '<div class="panel empty"><div class="empty-ic">🔔</div><p>No notifications yet. You will see it here when someone clicks Buy now on your card, or when a seller marks your order as sold.</p></div>'}
    <p class="muted">Want these on your phone lock screen too? Turn on <a href="#/settings">phone notifications in Settings</a>.</p>`;
  const clr = $app.querySelector('#nclr');
  if (clr) clr.onclick = guard(async () => { if (!confirm('Delete all notifications?')) return; await rpc('clear_notifications'); toast('Cleared'); window.dispatchEvent(new Event('notif-refresh')); viewNotifications($app); });
  if (unread.length) { try { await rpc('mark_notifications_read', { p_ids: unread }); window.dispatchEvent(new Event('notif-refresh')); } catch (_) { /* badge fixes itself next poll */ } }
}
