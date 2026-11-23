import { sb, state, esc, bnd, toast, guard, sheet, loadCatalog, cardImg, refBnd, enlarge, confirmSheet } from '../lib.js';

export const shareUrl = (token) => `${location.origin}${location.pathname}#/shared/${token}`;

// Share sheet opened from My collection: create/copy/send/stop the read-only link.
export async function openShareSheet(name = 'my') {
  let { data: token, error } = await sb.rpc('my_inventory_share');
  if (error) throw new Error(error.message);
  const s = sheet('<div class="loading">Loading…</div>');
  const draw = () => {
    const url = token ? shareUrl(token) : '';
    const text = `Check out ${name} One Piece card collection on Brunei One Piece TCG: ${url}`;
    s.el.querySelector('.sh-body')?.remove();
    const body = document.createElement('div'); body.className = 'sh-body';
    body.innerHTML = token ? `<h2>Share my collection</h2>
      <p class="muted">Anyone with this link can view your card list and quantities (read-only). Your WhatsApp number and prices are not shown.</p>
      <input id="sh-url" readonly value="${esc(url)}">
      <div class="row tight" style="margin-top:.6rem">
        <button class="btn" id="sh-copy">Copy link</button>
        <a class="btn sec" id="sh-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
        ${navigator.share ? '<button class="btn sec" id="sh-native">Share…</button>' : ''}
      </div>
      <p style="margin-top:.8rem"><button class="btn sec bad-link" id="sh-off">Stop sharing</button></p>`
      : `<h2>Share my collection</h2><p class="muted">Create a private link to send to other collectors. They can view your cards and quantities, read-only. You can turn it off any time.</p><button class="btn" id="sh-on">Create share link</button>`;
    [...s.el.children].forEach((c) => { if (!c.classList.contains('sheet-x')) c.remove(); });
    s.el.appendChild(body);
    const $ = (q) => body.querySelector(q);
    if (!token) $('#sh-on').onclick = guard(async () => { const { data, error: e } = await sb.rpc('share_inventory'); if (e) throw new Error(e.message); token = data; draw(); });
    else {
      $('#sh-copy').onclick = guard(async () => { try { await navigator.clipboard.writeText(url); } catch { $('#sh-url').select(); document.execCommand('copy'); } toast('Link copied'); });
      const n = $('#sh-native'); if (n) n.onclick = () => navigator.share({ title: 'Brunei One Piece TCG', text, url }).catch(() => {});
      $('#sh-off').onclick = guard(async () => {
        if (!(await confirmSheet('Stop sharing?', 'The current link will stop working. You can create a new one later.', 'Stop sharing', true))) return;
        const { error: e } = await sb.rpc('unshare_inventory'); if (e) throw new Error(e.message);
        token = null; toast('Sharing turned off'); s.close();
      });
    }
  };
  draw();
}

// Public read-only page: #/shared/<token>
export async function viewShared($app, token) {
  $app.innerHTML = '<div class="loading">Loading…</div>';
  const cat = await loadCatalog();
  const { data, error } = await sb.rpc('get_shared_inventory', { p_token: token || '' });
  if (error) { $app.innerHTML = `<div class="panel center"><h1>Collection not available</h1><p class="muted">${esc(error.message)}</p><a class="btn" href="#/">Go to Home</a></div>`; return; }
  const rows = (data.items || []).map((i) => ({ c: cat.byRef.get(i.card_ref), q: i.qty })).filter((r) => r.c);
  rows.sort((a, b) => a.c.code.localeCompare(b.c.code) || a.c.ref.localeCompare(b.c.ref));
  const count = rows.reduce((s, r) => s + r.q, 0), value = rows.reduce((s, r) => s + r.q * refBnd(r.c), 0);
  const mine = state.user && state.me && state.me.display_name === data.owner;
  $app.innerHTML = `<div class="head"><h1>${esc(data.owner)}’s collection</h1></div>
    <div class="hero small"><div class="muted">Shared collection${mine ? ' (yours)' : ''}</div><div class="big-num">${count} cards</div><div class="muted">${rows.length} unique · est. ${bnd(value)}</div></div>
    ${rows.length ? `<div class="grid">${rows.map(({ c, q }) => `<div class="tile" data-ref="${esc(c.ref)}"><div data-zoom>${cardImg(c)}</div><div class="b"><div class="code">${esc(c.code)} · ${esc(c.rarity)}</div><div class="nm">${esc(c.name)}</div><div class="row tight between"><span class="price">${c.jpy ? bnd(refBnd(c)) : ''}</span><b>×${q}</b></div></div></div>`).join('')}</div>` : '<div class="panel center"><p class="muted">This collection is empty.</p></div>'}`;
  $app.querySelectorAll('[data-zoom]').forEach((el) => { el.onclick = () => enlarge(cat.byRef.get(el.closest('[data-ref]').dataset.ref)); });
}
