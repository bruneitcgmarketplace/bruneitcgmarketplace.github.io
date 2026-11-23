import { state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, refBnd, cardImg, needLogin, bindLogin } from '../lib.js';
import * as scanner from '../scanner.js';
import { BW, BH, MARGIN, loadDb, dbReady, setFrame, recognise, makeTracker } from '../scanner.js';
window.__scanner = scanner; // test hook

const session = []; // staged cards: {code, ref, qty, on}
let stop = null;

let audioCtx = null;
function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 880 : 330; g.gain.value = 0.08; o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.09);
  } catch { /* no audio */ }
}

export async function viewScan($app) {
  if (!state.user) { $app.innerHTML = `<h1>Scan</h1>${needLogin('scan cards into your inventory')}`; return bindLogin($app); }
  const cat = await loadCatalog(); await loadInv();
  $app.innerHTML = `<h1>Scan</h1>
    <div class="panel"><div class="vbox" id="vbox"><video id="vid" playsinline muted></video>
        <div class="guide" id="guide"><i></i><i></i><i></i><i></i></div><div class="flash" id="flash"></div><div class="vhint" id="vhint">Camera is off</div></div>
      <div class="row tight" style="margin-top:.6rem"><button class="btn" id="cam">Start camera</button><button class="btn sec" id="torch" style="display:none">🔦 Light</button><label class="inline" style="margin:0"><input type="checkbox" id="snd" checked style="width:auto"> Beep</label></div>
      <div id="ss" class="scan-status muted">Put one card inside the frame. It is added automatically; take it out, then show the next card.</div>
      <div id="cands" class="row tight" style="margin-top:.4rem"></div></div>
    <div class="panel"><label>Or type a code</label><div class="row tight"><input id="code" placeholder="OP01-001" autocomplete="off" style="max-width:220px"><button class="btn sec" id="addc">Stage</button></div></div>
    <div id="staged"></div>`;
  const $ = (s) => $app.querySelector(s);

  const stage = (code, ref) => {
    const variants = cat.byCode.get(code); if (!variants) return false;
    const r = ref && cat.byRef.get(ref) ? ref : (variants.find((c) => c.def) || variants[0]).ref;
    const ex = session.find((s) => s.code === code && s.ref === r);
    if (ex) { ex.qty++; ex.on = true; session.splice(session.indexOf(ex), 1); session.unshift(ex); } else session.unshift({ code, ref: r, qty: 1, on: true });
    drawStaged(); return true;
  };
  const drawStaged = () => {
    const el = $('#staged'); if (!el) return;
    if (!session.length) { el.innerHTML = ''; return; }
    const total = session.filter((s) => s.on).reduce((a, s) => a + s.qty, 0);
    el.innerHTML = `<div class="panel nopad">${session.map((s, i) => { const c = cat.byRef.get(s.ref); const variants = cat.byCode.get(s.code);
      return `<div class="inv-row"><input type="checkbox" data-i="${i}" data-k="on" ${s.on ? 'checked' : ''} style="width:auto">
        <div class="img">${cardImg(c, 'sm')}</div><div class="grow"><b>${esc(s.code)}</b> ${esc(c.rarity)}<div class="muted nm">${esc(c.name)}</div>
        ${variants.length > 1 ? `<select data-i="${i}" data-k="ref" style="margin-top:.2rem">${variants.map((v) => `<option value="${esc(v.ref)}" ${v.ref === s.ref ? 'selected' : ''}>${esc(v.rarity)} ${v.parallel ? '(alt art)' : ''} ${v.jpy ? bnd(refBnd(v)) : ''}</option>`).join('')}</select>` : ''}</div>
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

  camBtn.onclick = guard(async () => {
    if (stop) { stop(); return; }
    camBtn.disabled = true; setStatus('Loading card database…');
    let stream;
    try {
      await loadDb((p) => setStatus(`Loading card database… ${Math.round(p * 100)}% (first time only)`));
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) { camBtn.disabled = false; setStatus('Put one card inside the frame.'); throw new Error('Camera unavailable: ' + (e.message || e) + '. You can still type codes.'); }
    const vid = $('#vid'); vid.srcObject = stream; await vid.play();
    const track = stream.getVideoTracks()[0]; let torchOn = false;
    try {
      const caps = track.getCapabilities?.() || {};
      if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      if (caps.torch) { const tb = $('#torch'); tb.style.display = ''; tb.onclick = () => { torchOn = !torchOn; track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {}); }; }
    } catch { /* optional features */ }
    camBtn.disabled = false; camBtn.textContent = 'Stop camera'; $('#vhint').style.display = 'none';
    let alive = true; const c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
    c1.width = BW * 2; c1.height = BH * 2; c2.width = BW; c2.height = BH;
    const x1 = c1.getContext('2d', { willReadFrequently: true }), x2 = c2.getContext('2d', { willReadFrequently: true });
    x1.imageSmoothingQuality = 'high'; x2.imageSmoothingQuality = 'high';
    const stats = (window.__scanStats = { frames: 0, ms: 0 });
    const tracker = makeTracker((code, ref, info) => {
      window.__scanHook?.(code, info);
      stage(code, ref); cands.innerHTML = ''; if ($('#snd')?.checked) beep(); navigator.vibrate?.(40);
      const c = cat.byRef.get(ref); flash(`✓ ${code} ${c?.name || ''}`);
    }, (s) => {
      if (s.kind === 'empty') { setStatus('Show a card inside the frame'); cands.innerHTML = ''; }
      else if (s.kind === 'seeing') setStatus(`Reading ${s.code}…`);
      else if (s.kind === 'glare') setStatus('Too much glare or too dark. Tilt the card away from the light, or tap 🔦.');
      else if (s.kind === 'done') setStatus(`✓ ${s.code} added. Take the card out, then show the next one.`);
      else if (s.kind === 'unsure') { setStatus(s.weak > 5 ? 'Not sure. Hold steady, fill the frame, avoid glare, or tap the right card below.' : 'Looking…'); if (s.weak > 5 && s.top.length) showCands(s.top); }
    });
    // where the guide frame sits inside the (object-fit: cover) video, in video pixels
    const guideRect = () => {
      const box = $('#vbox').getBoundingClientRect(), vw = vid.videoWidth, vh = vid.videoHeight;
      const sc = Math.max(box.width / vw, box.height / vh), offX = (box.width - vw * sc) / 2, offY = (box.height - vh * sc) / 2;
      const g = $('#guide').getBoundingClientRect();
      return { x: (g.left - box.left - offX) / sc, y: (g.top - box.top - offY) / sc, w: g.width / sc, h: g.height / sc };
    };
    stop = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); stop = null; const b = $('#cam'); if (b) b.textContent = 'Start camera'; const h = $('#vhint'); if (h) h.style.display = ''; const t = $('#torch'); if (t) t.style.display = 'none'; if ($('#cands')) $('#cands').innerHTML = ''; };
    (async function loop() {
      while (alive && document.body.contains(vid)) {
        const t0 = performance.now();
        try {
          if (vid.videoWidth) {
            const g = guideRect(), sx = g.x - g.w * MARGIN, sy = g.y - g.h * MARGIN, sw = g.w * (1 + 2 * MARGIN), sh = g.h * (1 + 2 * MARGIN);
            x1.drawImage(vid, sx, sy, sw, sh, 0, 0, c1.width, c1.height);
            x2.drawImage(c1, 0, 0, c1.width, c1.height, 0, 0, BW, BH);
            const q = setFrame(x2.getImageData(0, 0, BW, BH).data);
            const rr = q.poor ? { poor: true } : recognise();
            if (window.__debugFrames) { const ring = (window.__ring = window.__ring || []); ring.push({ url: c2.toDataURL('image/png'), code: rr.code, sim: rr.sim, margin: rr.margin, poor: !!rr.poor, cur: window.__sim?.cur }); if (ring.length > 10) ring.shift(); }
            tracker(rr);
          }
        } catch (e) { console.warn('scan frame', e); }
        const dt = performance.now() - t0; stats.frames++; stats.ms += dt;
        await new Promise((r) => setTimeout(r, Math.max(30, 90 - dt)));   // ~10 frames per second at most
      }
      if (alive) stop?.();
    })();
  });
}
export const stopScan = () => stop?.();
