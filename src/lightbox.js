// Global full-screen photo viewer. Any photo in the app opens here in its best quality:
// catalogue images -> Yuyutei 'front' (500x700, the largest they serve); seller photos -> the uploaded file (up to 1600 px).
// Pinch / wheel / double-tap to zoom, drag to pan, swipe or arrow keys between photos in the same group.

import { fallbackFor } from './fallback.js';
const BASE_RE = /(card\.yuyu-tei\.jp\/opc\/)(?:\d+_\d+|front)(\/)/;
const hiUrl = (src) => (src || '').replace(BASE_RE, '$1front$2');
const isTiny = (el) => el.closest('#top, #drawer, .av, .avatar, .pick, .dr-head') || el.classList.contains('avatar') || el.closest('#lb') || el.dataset.missing;

let root = null, st = null;

function fullOf(img) {
  if (img.dataset.src) return hiUrl(img.dataset.src);                 // listing thumbs carry the original
  if (img.dataset.ref && window.__catByRef) { const c = window.__catByRef.get(img.dataset.ref); if (c) return `https://card.yuyu-tei.jp/opc/front/${c.set}/${c.num}.jpg`; }
  if (img.dataset.hd) return img.dataset.hd;
  return hiUrl(img.currentSrc || img.src);
}

function groupOf(img) {
  const detail = img.closest('.detail');
  if (detail) {                                                         // listing / card page: all photos or arts of this item
    const th = [...detail.querySelectorAll('.thumbs img')];
    const urls = th.map(fullOf);
    const cur = fullOf(img.id === 'mainimg' ? img : img);
    const main = detail.querySelector('#mainimg');
    const mainFull = main ? hiUrl(main.src) : cur;
    if (urls.length > 1) { let i = urls.findIndex((u) => hiUrl(u) === mainFull); if (i < 0) i = 0; return { urls, alts: th.map((t) => t.alt || t.title || ''), i: img.closest('.thumbs') ? th.indexOf(img) : i }; }
    return { urls: [fullOf(main || img)], alts: [(main || img).alt || ''], i: 0 };
  }
  const box = img.closest('.grid, .hscroll, .panel.nopad, .setgrid');
  if (box) {
    const all = [...box.querySelectorAll('img')].filter((x) => !isTiny(x) && x.naturalWidth !== 0 && x.style.visibility !== 'hidden').slice(0, 80);
    const i = all.indexOf(img);
    if (i >= 0 && all.length > 1) return { urls: all.map(fullOf), alts: all.map((x) => x.alt || ''), i };
  }
  return { urls: [fullOf(img)], alts: [img.alt || ''], i: 0 };
}

export function openLightbox(urls, i = 0, alts = []) {
  closeLightbox();
  st = { urls, alts, i, s: 1, x: 0, y: 0, ptr: new Map(), pinch0: null, last: 0, sw: null };
  root = document.createElement('div');
  root.id = 'lb';
  root.innerHTML = `<div class="lb-top"><span id="lb-n"></span><span class="lb-cap" id="lb-cap"></span><a id="lb-src" target="_blank" rel="noopener" title="View this card on Yuyutei" style="display:none;width:auto;border-radius:19px;padding:0 .8rem;font-size:.85rem;font-weight:700;white-space:nowrap;text-decoration:none">Yuyutei ↗</a><a id="lb-open" target="_blank" rel="noopener" title="Open original">↗</a><button id="lb-x" aria-label="Close">✕</button></div>
    <div class="lb-stage" id="lb-stage"><img id="lb-img" alt="" draggable="false"><div class="lb-load" id="lb-load">Loading…</div></div>
    ${urls.length > 1 ? '<button class="lb-nav l" id="lb-prev" aria-label="Previous">‹</button><button class="lb-nav r" id="lb-next" aria-label="Next">›</button>' : ''}
    <div class="lb-hint" id="lb-hint">Pinch or double-tap to zoom</div>`;
  document.body.appendChild(root);
  document.body.classList.add('noscroll');
  bind();
  show(i);
  setTimeout(() => root?.querySelector('#lb-hint')?.classList.add('off'), 2500);
}

export function closeLightbox() {
  if (!root) return;
  root.remove(); root = null; st = null;
  document.body.classList.remove('noscroll');
  document.removeEventListener('keydown', onKey);
}

function apply() {
  const im = root.querySelector('#lb-img');
  im.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.s})`;
  im.style.cursor = st.s > 1 ? 'grab' : 'zoom-in';
}
function clamp() {
  const stage = root.querySelector('#lb-stage'), im = root.querySelector('#lb-img');
  const w = im.clientWidth * st.s, h = im.clientHeight * st.s, mx = Math.max(0, (w - stage.clientWidth) / 2), my = Math.max(0, (h - stage.clientHeight) / 2);
  st.x = Math.max(-mx, Math.min(mx, st.x)); st.y = Math.max(-my, Math.min(my, st.y));
}
function show(i) {
  st.i = (i + st.urls.length) % st.urls.length; st.s = 1; st.x = 0; st.y = 0;
  const im = root.querySelector('#lb-img'), url = st.urls[st.i], load = root.querySelector('#lb-load');
  load.style.display = ''; im.style.opacity = '.35';
  const hi = new Image();
  hi.onload = () => { if (!root || st.urls[st.i] !== url) return; im.src = hi.src; im.style.opacity = '1'; load.style.display = 'none'; apply(); };
  hi.onerror = () => { if (!root) return; const fb = fallbackFor(url); if (fb && hi.src !== fb) { hi.src = fb; return; } load.textContent = 'Could not load this photo'; };
  im.src = url.replace(BASE_RE, '$1250_350$2');           // instant preview while the sharp file loads (cached from the grid)
  hi.src = url;
  root.querySelector('#lb-n').textContent = st.urls.length > 1 ? `${st.i + 1} / ${st.urls.length}` : '';
  root.querySelector('#lb-cap').textContent = st.alts[st.i] || '';
  root.querySelector('#lb-open').href = url;
  const ym = /card\.yuyu-tei\.jp\/opc\/(?:\d+_\d+|front)\/([a-z0-9-]+)\/([A-Za-z0-9-]+)\.jpg/.exec(url), src = root.querySelector('#lb-src');
  src.style.display = ym ? '' : 'none'; if (ym) src.href = `https://yuyu-tei.jp/sell/opc/card/${ym[1]}/${ym[2]}`;
  apply();
}
function zoomAt(ns, cx, cy) {
  const stage = root.querySelector('#lb-stage').getBoundingClientRect();
  const px = cx - (stage.left + stage.width / 2), py = cy - (stage.top + stage.height / 2);
  ns = Math.max(1, Math.min(6, ns)); const k = ns / st.s;
  st.x = px - (px - st.x) * k; st.y = py - (py - st.y) * k; st.s = ns; if (ns === 1) { st.x = 0; st.y = 0; } clamp(); apply();
}
function onKey(e) {
  if (!root) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft' && st.urls.length > 1) show(st.i - 1);
  else if (e.key === 'ArrowRight' && st.urls.length > 1) show(st.i + 1);
  else if (e.key === '+' || e.key === '=') { const r = root.querySelector('#lb-stage').getBoundingClientRect(); zoomAt(st.s * 1.5, r.left + r.width / 2, r.top + r.height / 2); }
  else if (e.key === '-') { const r = root.querySelector('#lb-stage').getBoundingClientRect(); zoomAt(st.s / 1.5, r.left + r.width / 2, r.top + r.height / 2); }
}
function bind() {
  document.addEventListener('keydown', onKey);
  root.querySelector('#lb-x').onclick = closeLightbox;
  root.querySelector('#lb-prev')?.addEventListener('click', () => show(st.i - 1));
  root.querySelector('#lb-next')?.addEventListener('click', () => show(st.i + 1));
  const stage = root.querySelector('#lb-stage');
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(st.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId); st.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: Date.now() });
    if (st.ptr.size === 2) { const [a, b] = [...st.ptr.values()]; st.pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: st.s }; }
  });
  stage.addEventListener('pointermove', (e) => {
    const p = st.ptr.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (st.ptr.size === 2 && st.pinch0) { const [a, b] = [...st.ptr.values()]; zoomAt(st.pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / st.pinch0.d, (a.x + b.x) / 2, (a.y + b.y) / 2); }
    else if (st.s > 1) { st.x += dx; st.y += dy; clamp(); apply(); }
  });
  const up = (e) => {
    const p = st.ptr.get(e.pointerId); st.ptr.delete(e.pointerId); if (st.ptr.size < 2) st.pinch0 = null;
    if (!p) return;
    const mx = e.clientX - p.sx, my = e.clientY - p.sy, moved = Math.hypot(mx, my);
    if (st.s === 1 && moved > 60 && Math.abs(mx) > Math.abs(my) * 1.5 && st.urls.length > 1) { show(st.i + (mx < 0 ? 1 : -1)); return; }   // swipe
    if (moved < 8 && Date.now() - p.t < 350) {                                                                                           // tap
      const now = Date.now();
      if (now - st.last < 300) { zoomAt(st.s > 1 ? 1 : 2.6, e.clientX, e.clientY); st.last = 0; } else st.last = now;
      if (e.target === stage) setTimeout(() => { if (st && st.last && Date.now() - st.last >= 300 && st.s === 1) { /* single tap on backdrop closes */ closeLightbox(); } }, 320);
    }
  };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', (e) => { st.ptr.delete(e.pointerId); st.pinch0 = null; });
}

// ---------- global wiring ----------
export function initLightbox(catByRef) {
  window.__catByRef = catByRef;
  const app = document.getElementById('app');
  // magnifier button on photos that sit inside a link (tiles, order rows), so tapping the card still opens the item
  const addZoomBtn = (a) => {
    if (a.querySelector(':scope > .zb') || !a.querySelector('img')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'zb'; b.setAttribute('aria-label', 'View photo'); b.textContent = '🔍'; a.appendChild(b);
  };
  const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches?.('a.tile, a.oimg')) addZoomBtn(n); n.querySelectorAll?.('a.tile, a.oimg').forEach(addZoomBtn); };
  scan(app);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(scan))).observe(app, { childList: true, subtree: true });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#lb')) return;
    const zb = e.target.closest('.zb');
    if (zb) { e.preventDefault(); e.stopPropagation(); const img = zb.parentElement.querySelector('img'); if (img) { const g = groupOf(img); openLightbox(g.urls, g.i, g.alts); } return; }
    const img = e.target.closest('img');
    if (!img || isTiny(img) || !(app.contains(img) || img.closest('.sheet'))) return;
    if (img.closest('a')) return;                               // inside a link: the link wins, use the 🔍 button
    if (img.closest('.thumbs')) { return; }                    // thumbs switch the main photo (listing.js / explore.js)
    if (img.closest('.sheet') && img.closest('.pick')) return;
    e.preventDefault(); e.stopPropagation();
    const g = groupOf(img); openLightbox(g.urls, g.i, g.alts);
  }, true);
}
