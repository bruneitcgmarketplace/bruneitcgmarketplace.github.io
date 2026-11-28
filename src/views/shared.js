import { waUrl } from '../receipt.js';
import { cardFilter } from './exploreSets.js';
import { addToCart, cartIds } from '../cart.js';
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
  const sel = (r) => (mine ? '' : `<label class="usel"><input type="checkbox" data-pick ${picked.has(r.c.ref) ? 'checked' : ''}> Select</label>`) + (r.l ? `<a class="btn sm-btn" href="#/listing/${r.l.id}">On Marketplace · ${bnd(r.l.price)}${r.l.n > 1 ? ' · ' + r.l.n + ' avail' : ''}</a>` : '');
  const gridCell = (r) => `<div class="tile" data-ref="${esc(r.c.ref)}"><div data-zoom>${cardImg(r.c)}</div><div class="b"><div class="code">${esc(r.c.code)} · ${esc(r.c.rarity)}</div><div class="nm">${esc(r.c.name)}</div><div class="row tight between"><span class="price">${r.c.jpy ? bnd(refBnd(r.c)) : ''}</span><b>×${r.q}</b></div>${sel(r)}</div></div>`;
  const listRow = (r) => `<div class="inv-row shr" data-ref="${esc(r.c.ref)}"><div class="img" data-zoom>${cardImg(r.c, 'sm')}</div><div class="grow"><div><b>${esc(r.c.code)}</b> ${esc(r.c.rarity)} <b>×${r.q}</b></div><div class="muted nm">${esc(r.c.name)}</div><div class="muted">${r.c.jpy ? bnd(refBnd(r.c)) + ' ea' : 'No price'}</div><div class="shact">${sel(r)}</div></div></div>`;
  const shell = `<div class="head"><h1>${esc(data.owner)}’s collection</h1></div>
    <div class="hero small"><div class="muted">Shared collection${mine ? ' (yours)' : ''}</div><div class="big-num">${count} cards</div><div class="muted">${rows.length} unique</div></div>
    ${rows.length ? `<div class="panel"><div class="row"><input id="sq" placeholder="Search cards"><select id="ssort"><option value="code">Sort: Card code</option><option value="qty">Sort: Quantity</option><option value="name">Sort: Name</option></select></div>
      <div class="row tight" style="margin-top:.5rem"><button class="btn sec" id="sfb"></button><div class="vsw" id="svw"><button data-v="list" aria-label="List">☰</button><button data-v="grid" aria-label="Grid">▦</button><button data-v="tiles" aria-label="Tiles">▪▪▪</button></div></div></div>
      <div id="sbody"></div>${!mine ? '<div class="pickbar shbar"><button class="btn sec" id="pk-all">Select all</button><button class="btn" id="pk-cart" disabled>Add to cart (0)</button><button class="btn" id="pk-go" disabled>Contact collector (0)</button><small class="muted">Cards on the Marketplace go to your cart. Cards not listed go to the collector on WhatsApp.</small></div>' : ''}` : '<div class="panel center"><p class="muted">This collection is empty.</p></div>'}`;
  $app.innerHTML = shell;
  if (!rows.length) return;
  const $ = (s) => $app.querySelector(s);
  const go = $('#pk-go'), all = $('#pk-all'), cartB = $('#pk-cart');
  let shown = [];
  const upd = () => {
    if (!go) return;
    const pk = rows.filter((r) => picked.has(r.c.ref)), nc = pk.filter((r) => r.l).length, nn = pk.length - nc;
    cartB.textContent = `Add to cart (${nc})`; cartB.disabled = !nc;
    go.textContent = `Contact collector (${nn})`; go.disabled = !nn;
    all.textContent = shown.length && shown.every((r) => picked.has(r.c.ref)) ? `Deselect all (${shown.length})` : `Select all (${shown.length})`;
  };
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
  if (all) all.onclick = () => { const on = !(shown.length && shown.every((r) => picked.has(r.c.ref))); shown.forEach((r) => (on ? picked.add(r.c.ref) : picked.delete(r.c.ref))); draw(); };
  if (cartB) cartB.onclick = guard(async () => {
    if (!state.user) { toast('Sign in to add cards to your cart'); location.hash = '#/account'; return; }
    const pk = rows.filter((r) => picked.has(r.c.ref) && r.l); if (!pk.length) return;
    const have = new Set(cartIds()); let added = 0;
    for (const r of pk) if (!have.has(r.l.id)) { addToCart(r.l.id); added++; }
    toast(added ? `Added ${added} card${added === 1 ? '' : 's'} to your cart` : 'Already in your cart');
    if (added) location.hash = '#/cart';
  });
  if (go) go.onclick = guard(async () => {
    if (!state.user) { toast('Sign in to contact the collector'); location.hash = '#/account'; return; }
    const pick = rows.filter((r) => picked.has(r.c.ref) && !r.l).sort(sorters.code); if (!pick.length) return;
    const { data: ct, error: ce } = await sb.rpc('shared_contact', { p_token: token });
    if (ce) throw new Error(ce.message);
    const c0 = Array.isArray(ct) ? ct[0] : ct;
    const lines = pick.slice(0, 40).map((r) => `• ${r.c.code} ${r.c.rarity} ${r.c.name}`);
    const text = `Hi ${c0.display_name}, I'm interested in ${pick.length === 1 ? 'this card' : 'these cards'} from your collection on Brunei One Piece TCG. Are they available?\n${lines.join('\n')}${pick.length > 40 ? `\n…and ${pick.length - 40} more` : ''}\n\n${location.href}`;
    const s = sheet(`<h2>Contact ${esc(c0.display_name)}</h2><textarea id="pk-t" rows="9" style="width:100%">${esc(text)}</textarea><div class="row tight" style="margin-top:.6rem"><a class="btn" id="pk-wa" target="_blank" rel="noopener">Open WhatsApp</a></div>`);
    const ta = s.el.querySelector('#pk-t'), wa = s.el.querySelector('#pk-wa'); const sync = () => { wa.href = waUrl(c0.whatsapp, ta.value); }; ta.oninput = sync; sync();
  });
}


// One-page picture of many cards: pics = [{ url, qty, price }]. Returns a high-resolution JPEG blob (every card on a single image).
let fontsP = null;
function loadFonts() {   // heavy condensed display face from Google Fonts; falls back to Impact / Arial Narrow if offline
  if (!fontsP) fontsP = Promise.race([(async () => {
    for (const fam of ['Anton', 'Roboto+Condensed:wght@700']) {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${fam}&display=swap`)).text();
      const m = /font-family:\s*'([^']+)'[^}]*?font-weight:\s*(\d+)[^}]*?src:\s*url\(([^)]+)\)/s.exec(css); if (!m) continue;
      const ff = new FontFace(m[1], `url(${m[3]})`, { weight: m[2] }); await ff.load(); document.fonts.add(ff);
    }
  })().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  return fontsP;
}
export async function snapshotImage(title, sub, pics, link = '') {
  const n = pics.length, MAXC = 1000; pics = pics.slice(0, MAXC);
  const m = pics.length;
  const cols = Math.min(16, Math.max(3, Math.ceil(Math.sqrt(m * 1.1))));
  const LIM_AREA = 26e6, LIM_SIDE = 16000;
  let cell = 240, W, H, gap, pad, head, foot;
  for (; cell >= 70; cell -= 6) {
    gap = Math.round(cell * 0.07); pad = Math.round(cell * 0.2); head = Math.round(Math.max(190, cell * 0.9)); foot = Math.round(Math.max(70, cell * 0.35));
    W = pad * 2 + cols * cell + (cols - 1) * gap; H = head + Math.round(cell * 0.2) + Math.ceil(m / cols) * (Math.round(cell * 1.4) + gap) + foot;
    if (W * H <= LIM_AREA && H <= LIM_SIDE) break;
  }
  W = Math.max(W, 1100);
  const ch = Math.round(cell * 1.4), x0 = Math.round((W - (cols * cell + (cols - 1) * gap)) / 2), rows = Math.ceil(m / cols);
  const size = cell <= 110 ? '100_140' : cell <= 210 ? '200_280' : '250_350';
  await loadFonts();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  // clean white sheet: navy title with a One Piece red accent, thin colour rule, no branding text
  const NAVY = '#14213d', RED = '#c1121f', GOLD = '#f2b705', BLUE = '#1d5fa8', GREEN = '#2e8b57', ORANGE = '#e8731a';
  const FONT = `"Anton", Impact, "Haettenschweiler", "Arial Narrow Bold", "Roboto Condensed", sans-serif`;
  const BODY = `"Roboto Condensed", "Arial Narrow", "Segoe UI", Roboto, sans-serif`;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  const u = W / 1200, hu = Math.min(u, head / 215), band = Math.max(8, Math.round(10 * u));
  const stripe = (y) => { const cs = [RED, GOLD, GREEN, ORANGE, BLUE], w = W / cs.length; cs.forEach((c, i) => { g.fillStyle = c; g.fillRect(Math.round(i * w), y, Math.ceil(w), band); }); };
  stripe(0);
  // header block sits inside [band, head]; every size derives from the header height so nothing is clipped
  const top = band + Math.round(head * 0.10), blk = Math.round(head * 0.62);
  const tw = Math.round(14 * hu), tx = x0 + tw + Math.round(18 * hu), mw = W - 2 * x0 - Math.round(300 * hu);
  g.fillStyle = RED; g.fillRect(x0, top, tw, blk);
  g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
  const bold = (txt, x, y, w, ink, lw) => { g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = lw; g.strokeText(txt, x, y, w); g.fillText(txt, x, y, w); };
  g.font = `400 ${Math.round(70 * hu)}px ${FONT}`; bold(title.toUpperCase(), tx, top + Math.round(blk * 0.60), mw, NAVY, Math.max(1, Math.round(1.6 * hu)));
  g.font = `800 ${Math.round(26 * hu)}px ${BODY}`; g.fillStyle = '#6b7280'; g.fillText(sub.toUpperCase(), tx, top + blk, mw);
  g.textAlign = 'right';
  g.font = `400 ${Math.round(76 * hu)}px ${FONT}`; bold(String(n), W - x0, top + Math.round(blk * 0.60), Math.round(280 * hu), RED, Math.max(1, Math.round(1.2 * hu)));
  g.font = `800 ${Math.round(24 * hu)}px ${BODY}`; g.fillStyle = '#6b7280'; g.fillText(n === 1 ? 'CARD' : 'CARDS', W - x0, top + blk);
  g.textAlign = 'left';
  g.fillStyle = NAVY; g.fillRect(x0, Math.round(head * 0.90), W - 2 * x0, Math.max(3, Math.round(4 * hu)));
  // cards
  const load = (url) => new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  const drawTag = (txt, x, y, fs, fill, ink, align) => {
    g.font = `400 ${fs}px "Anton", Impact, "Arial Narrow Bold", sans-serif`; const w = g.measureText(txt).width + fs * 0.9, h = fs * 1.5, px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = fs * 0.4; g.shadowOffsetY = fs * 0.12; g.fillStyle = fill; rr(px, y, w, h, h / 2); g.fill(); g.restore();
    g.fillStyle = ink; g.fillText(txt, px + fs * 0.45, y + fs * 1.12);
  };
  let next = 0;
  const worker = async () => { while (next < m) {
    const k = next++, p = pics[k], x = x0 + (k % cols) * (cell + gap), y = head + Math.round(cell * 0.2) + Math.floor(k / cols) * (ch + gap);
    const im = await load(p.url.replace(/\/(?:\d+_\d+|front)\//, `/${size}/`));
    g.save(); g.shadowColor = 'rgba(20,33,61,.35)'; g.shadowBlur = cell * 0.07; g.shadowOffsetY = cell * 0.02; g.fillStyle = '#e5e7eb'; rr(x, y, cell, ch, cell * 0.05); g.fill(); g.restore();
    g.save(); rr(x, y, cell, ch, cell * 0.05); g.clip(); if (im) g.drawImage(im, x, y, cell, ch); g.restore();
    g.strokeStyle = 'rgba(20,33,61,.55)'; g.lineWidth = Math.max(1, cell / 90); rr(x, y, cell, ch, cell * 0.05); g.stroke();
    const fs = Math.max(11, Math.round(cell * 0.14));
    if (p.qty) drawTag(p.qty, x + cell - fs * 0.25, y + fs * 0.25, fs, '#c1121f', '#fff', 'right');
    if (p.price) drawTag(p.price, x + cell / 2, y + ch - fs * 1.75, fs, '#14213d', '#f2b705', 'center');
  } };
  await Promise.all(Array.from({ length: 8 }, worker));
  // footer: colour rule only
  stripe(H - band);
  if (n > MAXC) { g.fillStyle = RED; g.font = `400 ${Math.round(24 * u)}px ${FONT}`; g.fillText(`+${n - MAXC} MORE CARDS NOT SHOWN`, x0, H - band - Math.round(foot * 0.4), W - 2 * x0); }
  return await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
}

// Full-screen viewer: pinch / +/- / double-tap to zoom, drag to move.
export function zoomViewer(url) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column';
  wrap.innerHTML = `<div style="display:flex;gap:.5rem;padding:.5rem;background:#111;align-items:center"><button class="btn sec sm-btn" id="zv-m">−</button><button class="btn sec sm-btn" id="zv-p">+</button><button class="btn sec sm-btn" id="zv-f">Fit</button><span style="flex:1"></span><button class="btn sm-btn" id="zv-x">✕ Close</button></div>
    <div id="zv-s" style="flex:1;overflow:auto;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch"><img id="zv-i" src="${url}" alt="" style="display:block;width:100%;max-width:none;height:auto"></div>`;
  document.body.appendChild(wrap);
  const sc = wrap.querySelector('#zv-s'), im = wrap.querySelector('#zv-i');
  let w = sc.clientWidth;
  const MAXW = () => Math.max(im.naturalWidth * 1.5, sc.clientWidth * 3);
  const zoom = (f, cx = sc.clientWidth / 2, cy = sc.clientHeight / 2) => {
    const nw = Math.min(MAXW(), Math.max(sc.clientWidth, w * f)), r = nw / w;
    const ax = (sc.scrollLeft + cx) * r - cx, ay = (sc.scrollTop + cy) * r - cy;
    w = nw; im.style.width = nw + 'px'; sc.scrollLeft = ax; sc.scrollTop = ay;
  };
  wrap.querySelector('#zv-p').onclick = () => zoom(1.6); wrap.querySelector('#zv-m').onclick = () => zoom(1 / 1.6);
  wrap.querySelector('#zv-f').onclick = () => { w = sc.clientWidth; im.style.width = '100%'; sc.scrollLeft = sc.scrollTop = 0; };
  wrap.querySelector('#zv-x').onclick = () => wrap.remove();
  let last = 0; sc.addEventListener('click', (e) => { const now = Date.now(); if (now - last < 320) { const r = sc.getBoundingClientRect(); zoom(w < sc.clientWidth * 1.5 ? 2.5 : 0.01, e.clientX - r.left, e.clientY - r.top); } last = now; });
  let d0 = 0;
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  sc.addEventListener('touchstart', (e) => { if (e.touches.length === 2) d0 = dist(e); }, { passive: true });
  sc.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && d0) { e.preventDefault(); const d = dist(e), r = sc.getBoundingClientRect(); zoom(d / d0, (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top); d0 = d; } }, { passive: false });
  sc.addEventListener('touchend', () => { d0 = 0; }, { passive: true });
  sc.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); const r = sc.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); } }, { passive: false });
}

// Preview the message (editable), then send to WhatsApp / copy / system share. pics (optional) adds a one-page picture of the cards.
export function shareComposer(title, text, pics = null, sub = '', link = '', imgTitle = '', num = '') {
  const s = sheet(`<h2>${esc(title)}</h2><textarea id="sc-t" rows="7" style="width:100%">${esc(text)}</textarea>
    ${pics?.length ? `<div id="sc-pic" class="muted" style="margin:.5rem 0">Making the picture of ${pics.length} card${pics.length === 1 ? '' : 's'}…</div>` : ''}
    <div class="row tight" style="margin-top:.6rem">${pics?.length ? '<button class="btn" id="sc-img" disabled>📷 Share picture + link</button><button class="btn sec" id="sc-save" disabled>Save picture</button>' : ''}<a class="btn ${pics?.length ? 'sec' : ''}" id="sc-wa" target="_blank" rel="noopener">WhatsApp (text)</a><button class="btn sec" id="sc-copy">Copy</button>${navigator.share ? '<button class="btn sec" id="sc-nat">Share…</button>' : ''}</div>`);
  const t = s.el.querySelector('#sc-t'), wa = s.el.querySelector('#sc-wa');
  const sync = () => { wa.href = 'https://wa.me/' + String(num || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(t.value); };
  t.oninput = sync; sync();
  s.el.querySelector('#sc-copy').onclick = async () => { try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); } toast('Copied'); };
  const n = s.el.querySelector('#sc-nat'); if (n) n.onclick = () => navigator.share({ text: t.value }).catch(() => {});
  if (pics?.length) snapshotImage(imgTitle || title, sub, pics, link).then((blob) => {
    const box = s.el.querySelector('#sc-pic'); if (!box) return;
    if (!blob) { box.textContent = 'Could not make the picture.'; return; }
    const url = URL.createObjectURL(blob), file = new File([blob], 'cards.jpg', { type: 'image/jpeg' });
    box.innerHTML = `<div id="sc-prev" role="button" aria-label="Zoom picture" style="width:100%;height:42vh;border-radius:8px;background:#14213d url(${url}) center/contain no-repeat;cursor:zoom-in"></div><div class="muted" style="font-size:.78rem">Tap the picture to zoom in. ${pics.length} cards on one page.</div>`; box.querySelector('#sc-prev').onclick = () => zoomViewer(url);
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
  const go = (kind) => guard(async () => { const r = await build(kind); s.close(); if (typeof r === 'string') shareComposer(title, r); else shareComposer(title, r.text, r.pics, r.sub || '', r.link || '', r.ttl || ''); });
  s.el.querySelector('#sc-sel').onclick = go('selected'); s.el.querySelector('#sc-all').onclick = go('all');
  return s;
}
