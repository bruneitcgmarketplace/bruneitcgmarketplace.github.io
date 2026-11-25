import { waUrl } from '../receipt.js';
import { cardFilter } from './exploreSets.js';
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
  const listed = data.listed || {};
  const rows = (data.items || []).map((i) => ({ c: cat.byRef.get(i.card_ref), q: i.qty, l: listed[i.card_ref] })).filter((r) => r.c);
  const count = rows.reduce((s, r) => s + r.q, 0), value = rows.reduce((s, r) => s + r.q * refBnd(r.c), 0);
  const mine = state.user && state.me && state.me.display_name === data.owner;
  const cf = cardFilter('shfx', cat, () => draw());
  const picked = new Set();
  let view = localStorage.getItem('view_shr') || 'grid', q = '', sort = 'code';
  const sorters = { code: (a, b) => a.c.code.localeCompare(b.c.code) || a.c.ref.localeCompare(b.c.ref), value: (a, b) => b.q * refBnd(b.c) - a.q * refBnd(a.c), qty: (a, b) => b.q - a.q, name: (a, b) => a.c.name.localeCompare(b.c.name) };
  const sel = (r) => r.l ? `<a class="btn sm-btn" href="#/listing/${r.l.id}">On Marketplace · ${bnd(r.l.price)}${r.l.n > 1 ? ' · ' + r.l.n + ' avail' : ''}</a>` : mine ? '' : `<label class="usel"><input type="checkbox" data-pick ${picked.has(r.c.ref) ? 'checked' : ''}> Select</label>`;
  const gridCell = (r) => `<div class="tile" data-ref="${esc(r.c.ref)}"><div data-zoom>${cardImg(r.c)}</div><div class="b"><div class="code">${esc(r.c.code)} · ${esc(r.c.rarity)}</div><div class="nm">${esc(r.c.name)}</div><div class="row tight between"><span class="price">${r.c.jpy ? bnd(refBnd(r.c)) : ''}</span><b>×${r.q}</b></div>${sel(r)}</div></div>`;
  const listRow = (r) => `<div class="inv-row shr" data-ref="${esc(r.c.ref)}"><div class="img" data-zoom>${cardImg(r.c, 'sm')}</div><div class="grow"><div><b>${esc(r.c.code)}</b> ${esc(r.c.rarity)} <b>×${r.q}</b></div><div class="muted nm">${esc(r.c.name)}</div><div class="muted">${r.c.jpy ? bnd(refBnd(r.c)) + ' ea' : 'No price'}</div><div class="shact">${sel(r)}</div></div></div>`;
  const shell = `<div class="head"><h1>${esc(data.owner)}’s collection</h1></div>
    <div class="hero small"><div class="muted">Shared collection${mine ? ' (yours)' : ''}</div><div class="big-num">${count} cards</div><div class="muted">${rows.length} unique</div></div>
    ${rows.length ? `<div class="panel"><div class="row"><input id="sq" placeholder="Search cards"><select id="ssort"><option value="code">Sort: Card code</option><option value="qty">Sort: Quantity</option><option value="name">Sort: Name</option></select></div>
      <div class="row tight" style="margin-top:.5rem"><button class="btn sec" id="sfb"></button><div class="vsw" id="svw"><button data-v="list" aria-label="List">☰</button><button data-v="grid" aria-label="Grid">▦</button><button data-v="tiles" aria-label="Tiles">▪▪▪</button></div></div></div>
      <div id="sbody"></div>${!mine && rows.some((r) => !r.l) ? '<div class="pickbar"><button class="btn sec" id="pk-all">Select all not listed</button><button class="btn" id="pk-go" disabled>Contact collector (0)</button></div>' : ''}` : '<div class="panel center"><p class="muted">This collection is empty.</p></div>'}`;
  $app.innerHTML = shell;
  if (!rows.length) return;
  const $ = (s) => $app.querySelector(s);
  const go = $('#pk-go'), all = $('#pk-all');
  let shown = [];
  const upd = () => { if (!go) return; const n = picked.size; go.textContent = `Contact collector (${n})`; go.disabled = !n; const sh = shown.filter((r) => !r.l); all.textContent = sh.length && sh.every((r) => picked.has(r.c.ref)) ? 'Clear' : 'Select all not listed'; };
  const draw = () => {
    let list = rows.filter((r) => !q || (r.c.code + ' ' + r.c.name + ' ' + (r.c.jp || '')).toLowerCase().includes(q.toLowerCase()));
    if (cf.on()) { const ok = cf.pass(new Set(list.map((r) => r.c.ref))); list = list.filter((r) => ok.has(r.c.ref)); }
    list.sort(sorters[sort]); shown = list;
    $('#sfb').textContent = cf.label(); $('#sfb').className = 'btn ' + (cf.on() ? '' : 'sec');
    $app.querySelectorAll('#svw button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
    $('#sbody').innerHTML = !list.length ? '<p class="muted">No cards match.</p>' : view === 'list' ? `<div class="panel nopad">${list.map(listRow).join('')}</div>` : `<div class="grid${view === 'tiles' ? ' tiles' : ''}">${list.map(gridCell).join('')}</div>`;
    $app.querySelectorAll('input[data-pick]').forEach((b) => (b.onchange = () => { const ref = b.closest('[data-ref]').dataset.ref; if (b.checked) picked.add(ref); else picked.delete(ref); upd(); }));
    $app.querySelectorAll('[data-zoom]').forEach((el) => { el.onclick = () => enlarge(cat.byRef.get(el.closest('[data-ref]').dataset.ref)); });
    upd();
  };
  $('#sq').oninput = (e) => { q = e.target.value.trim(); draw(); };
  $('#ssort').onchange = (e) => { sort = e.target.value; draw(); };
  $app.querySelectorAll('#svw button').forEach((b) => (b.onclick = () => { view = b.dataset.v; localStorage.setItem('view_shr', view); draw(); }));
  $('#sfb').onclick = () => cf.open(() => { const ok = cf.pass(new Set(rows.map((r) => r.c.ref))); return rows.filter((r) => !cf.on() || ok.has(r.c.ref)).length; });
  await cf.ensure();
  draw();
  if (all) all.onclick = () => { const sh = shown.filter((r) => !r.l); const on = !(sh.length && sh.every((r) => picked.has(r.c.ref))); sh.forEach((r) => (on ? picked.add(r.c.ref) : picked.delete(r.c.ref))); draw(); };
  if (go) go.onclick = guard(async () => {
    if (!state.user) { toast('Sign in to contact the collector'); location.hash = '#/account'; return; }
    const pick = rows.filter((r) => picked.has(r.c.ref)).sort(sorters.code); if (!pick.length) return;
    const { data: ct, error: ce } = await sb.rpc('shared_contact', { p_token: token });
    if (ce) throw new Error(ce.message);
    const c0 = Array.isArray(ct) ? ct[0] : ct;
    const lines = pick.slice(0, 40).map((r) => `• ${r.c.code} ${r.c.rarity} ${r.c.name}`);
    const text = `Hi ${c0.display_name}, I'm interested in ${pick.length === 1 ? 'this card' : 'these cards'} from your collection on Brunei One Piece TCG. Are they available?\n${lines.join('\n')}${pick.length > 40 ? `\n…and ${pick.length - 40} more` : ''}\n\n${location.href}`;
    const s = sheet(`<h2>Contact ${esc(c0.display_name)}</h2><textarea id="pk-t" rows="9" style="width:100%">${esc(text)}</textarea><div class="row tight" style="margin-top:.6rem"><a class="btn" id="pk-wa" target="_blank" rel="noopener">Open WhatsApp</a></div>`);
    const ta = s.el.querySelector('#pk-t'), wa = s.el.querySelector('#pk-wa'); const sync = () => { wa.href = waUrl(c0.whatsapp, ta.value); }; ta.oninput = sync; sync();
  });
}


// One-page picture of many cards: { url, tag } each. Returns a JPEG blob (all cards on a single image).
export async function snapshotImage(title, sub, pics) {
  const n = pics.length, MAXC = 800; pics = pics.slice(0, MAXC);
  const size = n > 120 ? '100_140' : '200_280';
  const cols = Math.min(24, Math.max(3, Math.ceil(Math.sqrt(pics.length * 0.9))));
  const W = Math.min(2400, Math.max(1080, cols * 150)), pad = 14, gap = 8, head = 110;
  const cw = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols), ch = Math.round(cw * 1.4), rows = Math.ceil(pics.length / cols);
  const H = head + pad + rows * (ch + gap);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#14213d'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffc83d'; g.fillRect(0, 0, W, 8);
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(W / 28)}px sans-serif`; g.fillText(title, pad + 6, 62, W - 2 * pad);
  g.fillStyle = '#c9d1e0'; g.font = `${Math.round(W / 50)}px sans-serif`; g.fillText(sub, pad + 6, 98, W - 2 * pad);
  const load = (u) => new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = u; });
  let next = 0;
  const worker = async () => { while (next < pics.length) {
    const k = next++, p = pics[k], x = pad + (k % cols) * (cw + gap), y = head + pad + Math.floor(k / cols) * (ch + gap);
    const im = await load(p.url.replace(/\/(?:\d+_\d+|front)\//, `/${size}/`));
    if (im) g.drawImage(im, x, y, cw, ch); else { g.fillStyle = '#2b3a5c'; g.fillRect(x, y, cw, ch); }
    if (p.tag) { const fs = Math.max(11, Math.round(cw / 5)); g.font = `bold ${fs}px sans-serif`; const w = g.measureText(p.tag).width + fs * 0.7; g.fillStyle = '#c1121f'; g.fillRect(x + cw - w, y + ch - fs * 1.3, w, fs * 1.3); g.fillStyle = '#fff'; g.fillText(p.tag, x + cw - w + fs * 0.35, y + ch - fs * 0.3); }
  } };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  if (n > MAXC) { g.fillStyle = '#ffc83d'; g.font = `${Math.round(W / 50)}px sans-serif`; g.fillText(`+${n - MAXC} more cards`, W - 260, 98); }
  return await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
}

// Preview the message (editable), then send to WhatsApp / copy / system share. pics (optional) adds a one-page picture of the cards.
export function shareComposer(title, text, pics = null, sub = '') {
  const s = sheet(`<h2>${esc(title)}</h2><textarea id="sc-t" rows="7" style="width:100%">${esc(text)}</textarea>
    ${pics?.length ? `<div id="sc-pic" class="muted" style="margin:.5rem 0">Making the picture of ${pics.length} card${pics.length === 1 ? '' : 's'}…</div>` : ''}
    <div class="row tight" style="margin-top:.6rem">${pics?.length ? '<button class="btn" id="sc-img" disabled>📷 Share picture + link</button><button class="btn sec" id="sc-save" disabled>Save picture</button>' : ''}<a class="btn ${pics?.length ? 'sec' : ''}" id="sc-wa" target="_blank" rel="noopener">WhatsApp (text)</a><button class="btn sec" id="sc-copy">Copy</button>${navigator.share ? '<button class="btn sec" id="sc-nat">Share…</button>' : ''}</div>`);
  const t = s.el.querySelector('#sc-t'), wa = s.el.querySelector('#sc-wa');
  const sync = () => { wa.href = 'https://wa.me/?text=' + encodeURIComponent(t.value); };
  t.oninput = sync; sync();
  s.el.querySelector('#sc-copy').onclick = async () => { try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); } toast('Copied'); };
  const n = s.el.querySelector('#sc-nat'); if (n) n.onclick = () => navigator.share({ text: t.value }).catch(() => {});
  if (pics?.length) snapshotImage(title, sub, pics).then((blob) => {
    const box = s.el.querySelector('#sc-pic'); if (!box) return;
    if (!blob) { box.textContent = 'Could not make the picture.'; return; }
    const url = URL.createObjectURL(blob), file = new File([blob], 'cards.jpg', { type: 'image/jpeg' });
    box.innerHTML = `<img src="${url}" alt="Snapshot" style="width:100%;max-height:45vh;object-fit:contain;border-radius:8px;background:#14213d">`;
    const b1 = s.el.querySelector('#sc-img'), b2 = s.el.querySelector('#sc-save'); b1.disabled = b2.disabled = false;
    b1.onclick = async () => {
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: t.value }); return; } } catch (e) { if (e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = url; a.download = 'cards.jpg'; a.click(); toast('Picture saved. Attach it in WhatsApp and paste the text.');
      try { await navigator.clipboard.writeText(t.value); } catch { /* ignore */ }
    };
    b2.onclick = () => { const a = document.createElement('a'); a.href = url; a.download = 'cards.jpg'; a.click(); };
  });
  return s;
}

// Two-choice share sheet: selected items or everything. build(kind) returns the message text, or { text, pics, sub }.
export function shareChoice({ title, selCount, build, extra = '' }) {
  const s = sheet(`<h2>${esc(title)}</h2><p class="muted">Choose what to share. The message includes a link and a one-page picture of the cards.</p>
    <div class="row tight"><button class="btn ${selCount ? '' : 'sec'}" id="sc-sel" ${selCount ? '' : 'disabled'}>Share selected (${selCount})</button><button class="btn" id="sc-all">Share all</button></div>${extra}`);
  const go = (kind) => guard(async () => { const r = await build(kind); s.close(); if (typeof r === 'string') shareComposer(title, r); else shareComposer(title, r.text, r.pics, r.sub || ''); });
  s.el.querySelector('#sc-sel').onclick = go('selected'); s.el.querySelector('#sc-all').onclick = go('all');
  return s;
}
