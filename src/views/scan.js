import { state, esc, bnd, toast, guard, loadCatalog, loadInv, invAdjust, refBnd, cardImg, needLogin, bindLogin } from '../lib.js';

const session = []; // staged cards: {code, ref, qty, on}
let stop = null;

const L2D = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };
const D2L = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G' };
// Turn OCR noise like "OPO1-O12" into "OP01-012"; returns a candidate code string or null
export function normaliseCode(raw) {
  const m = raw.toUpperCase().replace(/[–—_.]/g, '-').match(/([A-Z0-9]{3,5})\s*-\s*([A-Z0-9]{3})/);
  if (!m) return null;
  const head = m[1], tail = m[2];
  const digits = head.slice(-2).replace(/[A-Z]/g, (ch) => L2D[ch] ?? ch);
  const letters = head.slice(0, -2).replace(/\d/g, (d) => D2L[d] ?? d).replace(/^[^A-Z]+/, '');
  const num = tail.replace(/[A-Z]/g, (ch) => L2D[ch] ?? ch);
  if (!letters || !/^\d{2}$/.test(digits) || !/^\d{3}$/.test(num)) return null;
  // stray leading letter, e.g. "XOP01" -> try dropping leading characters until the catalogue knows the code
  for (let i = 0; i < letters.length; i++) { const c = letters.slice(i) + digits + '-' + num; if (state.cat.byCode.has(c)) return c; }
  return null;
}

export async function viewScan($app) {
  if (!state.user) { $app.innerHTML = `<h1>Scan</h1>${needLogin('scan cards into your inventory')}`; return bindLogin($app); }
  const cat = await loadCatalog(); await loadInv();
  $app.innerHTML = `<h1>Scan</h1>
    <div class="panel"><div class="vbox"><video id="vid" playsinline muted></video><div class="vhint" id="vhint">Camera is off</div></div>
      <div class="row tight" style="margin-top:.6rem"><button class="btn" id="cam">Start camera</button><span class="muted" id="ocrst"></span></div>
      <p class="muted">Point the camera at the card code in the bottom corner (like OP01-001). A code is added after two clear reads. Camera needs HTTPS and your permission.</p></div>
    <div class="panel"><label>Or type a code</label><div class="row tight"><input id="code" placeholder="OP01-001" autocomplete="off" style="max-width:220px"><button class="btn sec" id="addc">Stage</button></div></div>
    <div id="staged"></div>`;
  const $ = (s) => $app.querySelector(s);

  const stage = (code) => {
    const variants = cat.byCode.get(code); if (!variants) return false;
    const def = variants.find((c) => c.def) || variants[0];
    const ex = session.find((s) => s.code === code);
    if (ex) ex.qty++; else session.unshift({ code, ref: def.ref, qty: 1, on: true });
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

  // ----- camera + OCR (Tesseract.js loaded on demand) -----
  const camBtn = $('#cam');
  camBtn.onclick = guard(async () => {
    if (stop) { stop(); return; }
    camBtn.disabled = true; $('#ocrst').textContent = 'Loading text recognition…';
    let worker, stream, alive = true;
    try {
      const T = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
      worker = await (T.createWorker || T.default.createWorker)('eng');
      await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', tessedit_pageseg_mode: '11' });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) { camBtn.disabled = false; $('#ocrst').textContent = ''; worker?.terminate?.(); throw new Error('Camera or text recognition unavailable: ' + (e.message || e) + '. You can still type codes.'); }
    const vid = $('#vid'); vid.srcObject = stream; await vid.play();
    camBtn.disabled = false; camBtn.textContent = 'Stop camera'; $('#vhint').style.display = 'none'; $('#ocrst').textContent = 'Scanning…';
    const seen = new Map(), latched = new Map(); const cv = document.createElement('canvas');
    stop = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); worker.terminate(); stop = null; const b = $('#cam'); if (b) b.textContent = 'Start camera'; const h = $('#vhint'); if (h) h.style.display = ''; const o = $('#ocrst'); if (o) o.textContent = ''; };
    (async function loop() {
      while (alive && document.body.contains(vid)) {
        try {
          const k = Math.min(1, 1100 / vid.videoWidth); cv.width = vid.videoWidth * k; cv.height = vid.videoHeight * k;
          const g = cv.getContext('2d'); g.filter = 'grayscale(1) contrast(1.7)'; g.drawImage(vid, 0, 0, cv.width, cv.height);
          const { data } = await worker.recognize(cv);
          const now = Date.now(), hits = new Set();
          for (const m of data.text.split(/\s+/).concat(data.text.replace(/\s+/g, ' ').match(/\S+\s*-\s*\S+/g) || [])) { const c = normaliseCode(m); if (c) hits.add(c); }
          for (const c of hits) {
            if (latched.has(c)) { latched.set(c, now); continue; }
            seen.set(c, (seen.get(c) || 0) + 1);
            if (seen.get(c) >= 2) { latched.set(c, now); seen.delete(c); stage(c); toast('Scanned ' + c); navigator.vibrate?.(60); }
          }
          for (const [c, t] of latched) if (now - t > 1200) latched.delete(c);
          for (const c of [...seen.keys()]) if (!hits.has(c)) seen.delete(c);
        } catch { /* skip frame */ }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (alive) stop?.();
    })();
  });
}
export const stopScan = () => stop?.();
