import { state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, refBnd, cardImg, needLogin, bindLogin, artShort } from '../lib.js';
import * as scanner from '../scanner.js';
import { loadLocator, setBuffer, setSource, freeBuffer, findOne, findMany, makeTracker } from '../scanner.js';
window.__scanner = scanner; // test hook

const session = []; // staged cards: {code, ref, qty, on}
let stop = null;

// Browsers keep audio muted until a tap: unlockAudio() runs on the Start camera tap and the Beep tick, so scan beeps can play later.
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch { /* no audio */ }
}
function beep(ok = true) {
  try {
    unlockAudio(); const ctx = audioCtx; if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    (ok ? [[880, 0], [1320, 0.13]] : [[330, 0]]).forEach(([hz, at]) => {   // two rising notes = added, one low note = problem
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.12);
      o.connect(g); g.connect(ctx.destination); o.start(t0 + at); o.stop(t0 + at + 0.13);
    });
  } catch { /* no audio */ }
}

export async function viewScan($app) {
  if (!state.user) { $app.innerHTML = `<h1>Scan</h1>${needLogin('scan cards into your inventory')}`; return bindLogin($app); }
  const cat = await loadCatalog(); await loadInv();
  $app.innerHTML = `<h1>Scan</h1>
    <div class="panel"><div class="vbox" id="vbox"><video id="vid" playsinline muted></video><canvas id="ov" class="ov"></canvas>
        <div class="flash" id="flash"></div><div class="vhint" id="vhint">Camera is off</div></div>
      <div class="row tight" style="margin-top:.6rem"><button class="btn" id="cam">Start camera</button><button class="btn sec" id="snap" disabled>📸 Snap</button><button class="btn sec" id="gal">🖼 From gallery</button><button class="btn sec" id="torch" style="display:none">🔦 Light</button><label class="inline" style="margin:0"><input type="checkbox" id="snd" checked style="width:auto"> Beep</label></div>
      <input type="file" id="file" accept="image/*" multiple hidden>
      <div id="ss" class="scan-status muted">Start the camera and show a card anywhere in view (about half the frame or bigger). Or pick photos from your gallery: one card or many.</div>
      <div id="cands" class="row tight" style="margin-top:.4rem"></div></div>
    <div id="res"></div>
    <div class="panel"><label>Or type a code</label><div class="row tight"><input id="code" placeholder="OP01-001" autocomplete="off" style="max-width:220px"><button class="btn sec" id="addc">Stage</button></div></div>
    <div id="staged"></div>`;
  const $ = (s) => $app.querySelector(s);

  const stage = (code, ref, quiet) => {
    const variants = cat.byCode.get(code); if (!variants) return false;
    const r = ref && cat.byRef.get(ref) ? ref : (variants.find((c) => c.def) || variants[0]).ref;
    const ex = session.find((s) => s.code === code && s.ref === r);
    if (ex) { ex.qty++; ex.on = true; session.splice(session.indexOf(ex), 1); session.unshift(ex); } else session.unshift({ code, ref: r, qty: 1, on: true });
    drawStaged();
    if (!quiet) { const row = session[0]; toast(`✓ Added ${code} ${cat.byRef.get(r)?.name || ''}${row.qty > 1 ? ` (${row.qty} in scan list)` : ''}`); }
    return true;
  };
  const drawStaged = () => {
    const el = $('#staged'); if (!el) return;
    if (!session.length) { el.innerHTML = ''; return; }
    const total = session.filter((s) => s.on).reduce((a, s) => a + s.qty, 0);
    el.innerHTML = `<div class="panel nopad">${session.map((s, i) => { const c = cat.byRef.get(s.ref); const variants = cat.byCode.get(s.code);
      return `<div class="inv-row"><input type="checkbox" data-i="${i}" data-k="on" ${s.on ? 'checked' : ''} style="width:auto">
        <div class="img">${cardImg(c, 'sm')}</div><div class="grow"><b>${esc(s.code)}</b> ${esc(c.rarity)}<div class="muted nm">${esc(c.name)}</div>
        ${variants.length > 1 ? `<select data-i="${i}" data-k="ref" style="margin-top:.2rem">${variants.map((v) => `<option value="${esc(v.ref)}" ${v.ref === s.ref ? 'selected' : ''}>${esc(v.rarity)} ${artShort(v) ? '(' + artShort(v) + ')' : ''} ${v.jpy ? bnd(refBnd(v)) : ''}</option>`).join('')}</select>` : ''}</div>
        <div class="stepper"><button data-i="${i}" data-k="dec">−</button><b>${s.qty}</b><button data-i="${i}" data-k="inc">+</button></div></div>`; }).join('')}</div>
      <div class="row tight"><button class="btn" id="addsel">Add ${total} selected to inventory</button><button class="btn sec" id="all">Select all</button><button class="btn sec" id="disc">Discard</button></div>`;
    el.querySelectorAll('[data-k]').forEach((x) => {
      const i = +x.dataset.i, k = x.dataset.k;
      if (k === 'on') x.onchange = () => { session[i].on = x.checked; drawStaged(); };
      else if (k === 'ref') x.onchange = () => { session[i].ref = x.value; drawStaged(); };
      else x.onclick = () => { session[i].qty = Math.max(1, session[i].qty + (k === 'inc' ? 1 : -1)); drawStaged(); };
    });
    el.querySelector('#all').onclick = () => { session.forEach((s) => (s.on = true)); drawStaged(); };
    el.querySelector('#disc').onclick = () => { session.length = 0; drawStaged(); };
    el.querySelector('#addsel').onclick = guard(async () => {
      const pick = session.filter((s) => s.on); if (!pick.length) throw new Error('Nothing selected');
      for (const s of pick) await invAdjust(s.ref, s.qty);
      for (const s of pick) session.splice(session.indexOf(s), 1);
      toast(`Added ${total} cards to inventory`); drawStaged();
    });
  };
  const typed = () => { const v = $('#code').value.trim().toUpperCase(); if (!v) return; if (stage(v)) { $('#code').value = ''; } else toast('Code not in catalogue: ' + v, true); };
  $('#addc').onclick = typed; $('#code').onkeydown = (e) => { if (e.key === 'Enter') typed(); };
  drawStaged();

  // ----- live recognition -----
  const camBtn = $('#cam'), ss = $('#ss'), cands = $('#cands');
  const setStatus = (t) => { if (ss.textContent !== t) ss.textContent = t; };
  const flash = (txt) => { const f = $('#flash'); if (!f) return; f.textContent = txt; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); };
  const showCands = (top) => {
    cands.innerHTML = top.map((t, i) => { const c = cat.byRef.get(t.ref); return `<button class="btn sec sm-btn" data-ref="${esc(t.ref)}" data-code="${esc(t.code)}">${esc(t.code)} ${esc((c?.name || '').slice(0, 18))}</button>`; }).join('');
    cands.querySelectorAll('button').forEach((b) => (b.onclick = () => { stage(b.dataset.code, b.dataset.ref); cands.innerHTML = ''; beep(); }));
  };

  // ----- photos: one or many cards -----
  let busy = false;
  const LW = 288, LH = 384;
  async function analyse(src, name) {
    const resEl = $('#res'); busy = true;
    try {
      const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height, k = Math.min(1, 1120 / Math.max(sw, sh));
      const cv = document.createElement('canvas'); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, cv.width, cv.height);
      resEl.innerHTML = `<div class="panel"><b>${esc(name)}</b><div class="bt" style="margin-top:.5rem"><i id="pg" style="width:3%"></i></div><p class="muted" id="pgt">Loading card database…</p></div>`;
      await loadLocator((p) => { const t = resEl.querySelector('#pgt'); if (t) t.textContent = `Loading card database… ${Math.round(p * 100)}% (first time only)`; });
      const t0 = performance.now();
      const q = setBuffer(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height); setSource(cv);
      const found = await findMany({}, (p) => { const g = resEl.querySelector('#pg'), t = resEl.querySelector('#pgt'); if (g) g.style.width = Math.max(3, p * 100) + '%'; if (t) t.textContent = 'Looking for cards…'; });
      freeBuffer(); setSource(null); window.__lastAnalyse = { ms: performance.now() - t0, n: found.length, found: found.map((f) => ({ code: f.code, sim: +f.sim.toFixed(3), margin: +f.margin.toFixed(3), rect: [f.rect.cx, f.rect.cy, f.rect.cw, f.rect.ch].map(Math.round) })), w: cv.width, h: cv.height };
      showResults(cv, found, name, q.poor);
    } finally { busy = false; }
  }
  function showResults(cv, found, name, poor) {
    const resEl = $('#res');
    const items = found.map((f, i) => ({ i, f, ref: f.ref, on: f.sim >= 0.72 || (f.sim >= 0.62 && f.margin >= 0.08) }));
    const overlay = document.createElement('canvas'); overlay.className = 'resimg'; overlay.width = cv.width; overlay.height = cv.height;
    const og = overlay.getContext('2d'); og.drawImage(cv, 0, 0);
    items.forEach((it) => { const r = it.f.rect; og.lineWidth = Math.max(3, cv.width / 300); og.strokeStyle = it.on ? '#2fc76d' : '#ffc83d'; og.save(); og.translate(r.cx + r.cw / 2, r.cy + r.ch / 2); og.rotate(((it.f.angle || 0) * Math.PI) / 180); og.strokeRect(-r.cw / 2, -r.ch / 2, r.cw, r.ch); og.restore(); og.fillStyle = og.strokeStyle; const fs = Math.max(14, r.cw / 4); og.font = `700 ${fs}px sans-serif`; og.fillRect(r.cx, r.cy, fs * 1.5, fs * 1.2); og.fillStyle = '#000'; og.fillText(String(it.i + 1), r.cx + fs * 0.2, r.cy + fs * 0.95); });
    const thumb = (r, ang) => { const t = document.createElement('canvas'); t.width = 56; t.height = 78; const g = t.getContext('2d'); g.translate(28, 39); g.rotate((-ang * Math.PI) / 180); g.scale(56 / r.cw, 78 / r.ch); g.drawImage(cv, -(r.cx + r.cw / 2), -(r.cy + r.ch / 2)); return t.toDataURL('image/jpeg', 0.8); };
    items.forEach((it) => (it.thumb = thumb(it.f.rect, it.f.angle || 0)));
    const draw = () => {
      const n = items.filter((x) => x.on).length;
      resEl.innerHTML = `<div class="panel"><div class="row tight between"><b>${esc(name)}</b><button class="x-btn" id="rclose" aria-label="Close">✕</button></div>
        <div class="resimg-wrap" id="rimg"></div>
        <p class="muted">${found.length ? `Found ${found.length} card${found.length > 1 ? 's' : ''}. Green = confident, yellow = check it. Fix the match or untick before staging.` : 'No cards found. Make sure whole cards are visible and fairly large in the photo, avoid glare, or try rotating the photo.'}${poor ? ' The photo looks very bright or very dark.' : ''}</p>
        ${items.map((it, i) => { const c = cat.byRef.get(it.ref); const alts = it.f.top; return `<div class="inv-row"><input type="checkbox" data-i="${i}" data-k="on" ${it.on ? 'checked' : ''} style="width:auto"><b>${it.i + 1}</b>
          <img class="xs ph" src="${it.thumb}" alt=""><div class="img">${c ? cardImg(c, 'sm') : ''}</div>
          <div class="grow"><b>${esc(c?.code || '')}</b> ${esc(c?.rarity || '')} <span class="chip ${it.on ? 'ok' : 'warn'}">${Math.round(it.f.sim * 100)}%</span><div class="muted nm">${esc(c?.name || '')}</div>
          ${alts.length > 1 ? `<select data-i="${i}" data-k="alt" style="margin-top:.2rem">${alts.map((a) => { const ac = cat.byRef.get(a.ref); return `<option value="${esc(a.ref)}" ${a.ref === it.ref ? 'selected' : ''}>${esc(a.code)} ${esc(ac?.rarity || '')} ${esc((ac?.name || '').slice(0, 22))} (${Math.round(a.sim * 100)}%)</option>`; }).join('')}</select>` : ''}</div></div>`; }).join('')}
        <div class="row tight" style="margin-top:.6rem">${n ? `<button class="btn" id="rstage">Stage ${n} selected</button>` : ''}<button class="btn sec" id="rrot">↻ Rotate and retry</button></div></div>`;
      resEl.querySelector('#rimg').appendChild(overlay);
      resEl.querySelector('#rclose').onclick = () => (resEl.innerHTML = '');
      resEl.querySelectorAll('[data-k]').forEach((x) => { const i = +x.dataset.i, k = x.dataset.k; x.onchange = () => { if (k === 'on') items[i].on = x.checked; else { items[i].ref = x.value; items[i].on = true; } draw(); }; });
      const st = resEl.querySelector('#rstage'); if (st) st.onclick = () => { let c = 0; for (const it of items) if (it.on) { stage(cat.byRef.get(it.ref).code, it.ref, true); c++; } resEl.innerHTML = ''; toast(`${c} card${c > 1 ? 's' : ''} staged. Check the list, then add to inventory.`); };
      resEl.querySelector('#rrot').onclick = guard(async () => { const r = document.createElement('canvas'); r.width = cv.height; r.height = cv.width; const g = r.getContext('2d'); g.translate(r.width, 0); g.rotate(Math.PI / 2); g.drawImage(cv, 0, 0); await analyse(r, name + ' (rotated)'); });
    };
    draw();
    resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#gal').onclick = () => $('#file').click();
  $('#snd').onchange = (e) => { if (e.target.checked) beep(); };   // test beep, and unlocks audio
  $('#file').onchange = guard(async (e) => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    for (const f of files) { const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); await analyse(bmp, f.name); bmp.close?.(); if (files.length > 1) await new Promise((r) => setTimeout(r, 50)); }
  });

  // ----- live camera -----
  camBtn.onclick = guard(async () => {
    unlockAudio();
    if (stop) { stop(); return; }
    camBtn.disabled = true; setStatus('Loading card database…');
    let stream;
    try {
      await loadLocator((p) => setStatus(`Loading card database… ${Math.round(p * 100)}% (first time only)`));
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) { camBtn.disabled = false; setStatus('Start the camera and show a card in view.'); throw new Error('Camera unavailable: ' + (e.message || e) + '. You can still use photos from your gallery or type codes.'); }
    const vid = $('#vid'); vid.srcObject = stream; await vid.play();
    const track = stream.getVideoTracks()[0]; let torchOn = false;
    try {
      const caps = track.getCapabilities?.() || {};
      if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      if (caps.torch) { const tb = $('#torch'); tb.style.display = ''; tb.onclick = () => { torchOn = !torchOn; track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {}); }; }
    } catch { /* optional features */ }
    camBtn.disabled = false; camBtn.textContent = 'Stop camera'; $('#vhint').style.display = 'none'; $('#snap').disabled = false;
    let alive = true; const c1 = document.createElement('canvas'); c1.width = LW; c1.height = LH;
    const x1 = c1.getContext('2d', { willReadFrequently: true }); x1.imageSmoothingQuality = 'high';
    const ov = $('#ov'), og = ov.getContext('2d');
    const stats = (window.__scanStats = { frames: 0, ms: 0 });
    const drawRect = (rect, colour) => {
      const bx = $('#vbox').getBoundingClientRect(); if (ov.width !== Math.round(bx.width)) { ov.width = Math.round(bx.width); ov.height = Math.round(bx.height); }
      og.clearRect(0, 0, ov.width, ov.height); if (!rect) return;
      const k = ov.width / LW; og.lineWidth = 3; og.strokeStyle = colour; og.strokeRect(rect.cx * k, rect.cy * k, rect.cw * k, rect.ch * k);
    };
    let lastRect = null, lost = 0;
    const tracker = makeTracker((code, ref, info) => {
      window.__scanHook?.(code, info);
      stage(code, ref); cands.innerHTML = ''; if ($('#snd')?.checked) beep(); navigator.vibrate?.(40);
      const c = cat.byRef.get(ref); flash(`✓ Added ${code} ${c?.name || ''}`); drawRect(lastRect, '#2fc76d');
    }, (s) => {
      if (s.kind === 'empty') { setStatus('Show a card in view'); cands.innerHTML = ''; drawRect(null); }
      else if (s.kind === 'seeing') { setStatus(`Reading ${s.code}…`); drawRect(lastRect, '#ffc83d'); }
      else if (s.kind === 'glare') setStatus('Too much glare or too dark. Tilt the card away from the light, or tap 🔦.');
      else if (s.kind === 'done') setStatus(`✓ ${s.code} added. Take the card out, then show the next one.`);
      else if (s.kind === 'unsure') { setStatus(s.weak > 5 ? 'Not sure. Hold steady, fill more of the frame, avoid glare, tap the right card below, or tap 📸 Snap.' : 'Looking…'); drawRect(lastRect, '#ff9b3d'); if (s.weak > 5 && s.top.length) showCands(s.top); }
    });
    // the video is shown object-fit: cover inside the box; the analysis buffer is exactly what the user sees
    const view = () => {
      const box = $('#vbox').getBoundingClientRect(), vw = vid.videoWidth, vh = vid.videoHeight, sc = Math.max(box.width / vw, box.height / vh);
      const sw = box.width / sc, sh = box.height / sc; return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
    };
    $('#snap').onclick = guard(async () => { if (busy || !vid.videoWidth) return; const v = view(); const c = document.createElement('canvas'); c.width = Math.round(v.sw); c.height = Math.round(v.sh); c.getContext('2d').drawImage(vid, v.sx, v.sy, v.sw, v.sh, 0, 0, c.width, c.height); await analyse(c, 'Snapshot'); });
    stop = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); stop = null; const b = $('#cam'); if (b) b.textContent = 'Start camera'; const h = $('#vhint'); if (h) h.style.display = ''; const t = $('#torch'); if (t) t.style.display = 'none'; const sn = $('#snap'); if (sn) sn.disabled = true; if ($('#cands')) $('#cands').innerHTML = ''; if ($('#ov')) $('#ov').getContext('2d').clearRect(0, 0, 9999, 9999); };
    (async function loop() {
      while (alive && document.body.contains(vid)) {
        const t0 = performance.now();
        try {
          if (vid.videoWidth && !busy) {
            const v = view(); x1.drawImage(vid, v.sx, v.sy, v.sw, v.sh, 0, 0, LW, LH);
            const q = setBuffer(x1.getImageData(0, 0, LW, LH).data, LW, LH); setSource(c1);
            const useHint = lastRect && lost === 0 && stats.frames % 10 !== 0;
            const rr = q.poor ? { poor: true } : findOne(useHint ? lastRect : null);
            if (rr.rect) { lastRect = rr.rect; lost = 0; } else { lost++; if (lost > 2) lastRect = null; }
            if (window.__debugFrames) { const ring = (window.__ring = window.__ring || []); ring.push({ url: c1.toDataURL('image/png'), code: rr.code, sim: rr.sim, margin: rr.margin, poor: !!rr.poor, rect: rr.rect }); if (ring.length > 10) ring.shift(); }
            tracker(rr);
          }
        } catch (e) { console.warn('scan frame', e); }
        const dt = performance.now() - t0; stats.frames++; stats.ms += dt;
        await new Promise((r) => setTimeout(r, Math.max(30, 100 - dt)));
      }
      if (alive) stop?.();
    })();
  });
}
export const stopScan = () => stop?.();
