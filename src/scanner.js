// Card recogniser: matches the camera view against an art fingerprint of every catalogue card (public/features.bin).
// No OCR. Feature extraction must stay identical to feat_v() in tools/build_features.py.
import { state } from './lib.js';

export const BW = 160, BH = 224, MARGIN = 0.05;           // capture buffer (card box + 5% margin on every side)
const GW = 16, GH = 22, CW = 6, CH = 8, WC = 0.6, GRAD = 0.5, HP = 3, INSET = [0.04, 0.03];
const SHIFTS = [[0, 0, 0], [0.02, 0, 0], [-0.02, 0, 0], [0, 0.02, 0], [0, -0.02, 0], [0, 0, 0.02], [0, 0, -0.02], [0.02, 0.02, 0], [-0.02, -0.02, 0]];
const R0 = MARGIN / (1 + 2 * MARGIN), K = 1 / (1 + 2 * MARGIN);
const NG = GW * GH, NC = CW * CH * 3, NGR = (GH - 1) * (GW - 1), DIM = NG + NC + NGR;
const PRE = 60;                                            // candidates kept after the centre-crop pass

let db = null;                                             // {n, X: Float32Array(n*DIM), refs}
export const dbReady = () => !!db;

export async function loadDb(onProgress) {
  if (db) return db;
  const sizes = [0, 0], got = [0, 0];
  const one = async (k) => {                                 // the database is shipped as two files to stay under upload limits
    const res = await fetch(import.meta.env.BASE_URL + `features-${k + 1}.bin`);
    if (!res.ok) throw new Error('Card database not found');
    sizes[k] = +res.headers.get('content-length') || 0;
    const rd = res.body.getReader(), parts = [];
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got[k] += value.length; const tot = sizes[0] + sizes[1]; if (tot && onProgress) onProgress((got[0] + got[1]) / tot); }
    const b = new Uint8Array(got[k]); let o = 0; for (const p of parts) { b.set(p, o); o += p.length; }
    return b;
  };
  const [p1, p2] = await Promise.all([one(0), one(1)]);
  const buf = new Uint8Array(p1.length + p2.length); buf.set(p1, 0); buf.set(p2, p1.length);
  const dv = new DataView(buf.buffer);
  if (String.fromCharCode(...buf.slice(0, 4)) !== 'BTF1') throw new Error('Bad card database');
  const n = dv.getUint32(4, true), dim = dv.getUint32(8, true), scale = dv.getFloat32(12, true);
  if (dim !== DIM) throw new Error('Card database does not match this app version');
  const rawRefs = state.cat.rawRefs;
  if (rawRefs.length !== n) throw new Error('Card database is out of date with the catalogue (rebuild the features files)');
  const q = new Int8Array(buf.buffer, 16, n * dim), X = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    let s = 0; const b = i * dim;
    for (let j = 0; j < dim; j++) { const v = q[b + j] / scale; X[b + j] = v; s += v * v; }
    if (s > 0) { const inv = 1 / Math.sqrt(s); for (let j = 0; j < dim; j++) X[b + j] *= inv; }
  }
  db = { n, X, refs: rawRefs, codes: rawRefs.map((r) => state.cat.byRef.get(r)?.code) };
  return db;
}

// ----- integral images over the current buffer (BW x BH for the legacy fixed crop; any size for photos and wide camera frames) -----
let IW = BW, IH = BH, W1 = BW + 1, iL, iR, iG, iB;
function alloc(w, h) {
  if (iL && w === IW && h === IH) return;
  IW = w; IH = h; W1 = w + 1; const n = W1 * (h + 1);
  iL = new Float64Array(n); iR = new Float64Array(n); iG = new Float64Array(n); iB = new Float64Array(n);
}
alloc(BW, BH);
export const bufSize = () => ({ w: IW, h: IH });
export function setBuffer(rgba, w, h) {
  alloc(w, h);
  return fillIntegral(rgba, w, h);
}
function fillIntegral(rgba, w, h) {
  let sat = 0, tot = 0;
  for (let y = 0; y < h; y++) {
    let sl = 0, sr = 0, sg = 0, sb = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b; sl += lum; sr += r; sg += g; sb += b; tot += lum; if (lum > 240) sat++;
      const i = (y + 1) * W1 + x + 1, u = y * W1 + x + 1;
      iL[i] = iL[u] + sl; iR[i] = iR[u] + sr; iG[i] = iG[u] + sg; iB[i] = iB[u] + sb;
    }
  }
  const mean = tot / (w * h), satFrac = sat / (w * h);
  return { mean, sat: satFrac, poor: satFrac > 0.3 || mean < 25 };   // blown-out glare or too dark: do not trust matches
}
export const setFrame = (rgba) => setBuffer(rgba, BW, BH);
// second, small buffer for rotated crops (see recogniseRotated)
const sN = (BW + 1) * (BH + 1), sL = new Float64Array(sN), sR = new Float64Array(sN), sG = new Float64Array(sN), sB = new Float64Array(sN);
let stash = null, srcCanvas = null, rotCv = null, rotCx = null;
export const setSource = (c) => { srcCanvas = c; };
function recogniseRotated(rect, deg) {
  if (!srcCanvas) return null;
  if (!rotCv) { rotCv = document.createElement('canvas'); rotCv.width = BW; rotCv.height = BH; rotCx = rotCv.getContext('2d', { willReadFrequently: true }); rotCx.imageSmoothingQuality = 'high'; }
  const sw = rect.cw * (1 + 2 * MARGIN), sh = rect.ch * (1 + 2 * MARGIN);
  rotCx.setTransform(1, 0, 0, 1, 0, 0); rotCx.fillStyle = '#808080'; rotCx.fillRect(0, 0, BW, BH);
  rotCx.translate(BW / 2, BH / 2); rotCx.rotate((-deg * Math.PI) / 180); rotCx.scale(BW / sw, BH / sh);
  rotCx.drawImage(srcCanvas, -(rect.cx + rect.cw / 2), -(rect.cy + rect.ch / 2));
  const data = rotCx.getImageData(0, 0, BW, BH).data;
  stash = { IW, IH, W1, iL, iR, iG, iB }; IW = BW; IH = BH; W1 = BW + 1; iL = sL; iR = sR; iG = sG; iB = sB;
  try { fillIntegral(data, BW, BH); return recognise(); } finally { ({ IW, IH, W1, iL, iR, iG, iB } = stash); stash = null; }
}
export function freeBuffer() { iL = iR = iG = iB = null; alloc(BW, BH); }
function box(ii, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.min(IW - 1, Math.round(x0))); y0 = Math.max(0, Math.min(IH - 1, Math.round(y0)));
  x1 = Math.max(x0 + 1, Math.min(IW, Math.round(x1))); y1 = Math.max(y0 + 1, Math.min(IH, Math.round(y1)));
  return (ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
}
const hp = new Float32Array(NG), gray = new Float32Array(NG), colv = new Float32Array(NC), mag = new Float32Array(NGR);
// Fingerprint of a card whose outer edge is the rectangle (cx, cy, cw, ch) in buffer pixels. ds widens the inset (scale jitter).
export function extractCard(rx, ry, rw, rh, ds = 0, out = new Float32Array(DIM)) {
  const ix = INSET[0] + ds, iy = INSET[1] + ds;
  const bx0 = rx + ix * rw, bx1 = rx + (1 - ix) * rw, by0 = ry + iy * rh, by1 = ry + (1 - iy) * rh;
  const cw = (bx1 - bx0) / GW, ch = (by1 - by0) / GH;
  let m = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const v = box(iL, bx0 + x * cw, by0 + y * ch, bx0 + (x + 1) * cw, by0 + (y + 1) * ch); gray[y * GW + x] = v; m += v; }
  // high-pass: subtract the local mean over a (2*HP+1)^2 window (edge cells use the valid part)
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    let a = 0, c = 0;
    for (let yy = Math.max(0, y - HP); yy <= Math.min(GH - 1, y + HP); yy++) for (let xx = Math.max(0, x - HP); xx <= Math.min(GW - 1, x + HP); xx++) { a += gray[yy * GW + xx]; c++; }
    hp[y * GW + x] = gray[y * GW + x] - a / c;
  }
  m = 0; for (let i = 0; i < NG; i++) m += hp[i]; m /= NG;
  let sd = 0; for (let i = 0; i < NG; i++) sd += (hp[i] - m) ** 2; sd = Math.sqrt(sd / NG) + 1e-3;
  const sg = 1 / Math.sqrt(NG);
  for (let i = 0; i < NG; i++) out[i] = ((hp[i] - m) / sd) * sg;
  // colour
  const cw2 = (bx1 - bx0) / CW, ch2 = (by1 - by0) / CH; const mc = [0, 0, 0];
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const a = bx0 + x * cw2, b = by0 + y * ch2, c = bx0 + (x + 1) * cw2, d = by0 + (y + 1) * ch2, o = (y * CW + x) * 3;
    colv[o] = box(iR, a, b, c, d); colv[o + 1] = box(iG, a, b, c, d); colv[o + 2] = box(iB, a, b, c, d);
    mc[0] += colv[o]; mc[1] += colv[o + 1]; mc[2] += colv[o + 2];
  }
  const nc = CW * CH; mc[0] /= nc; mc[1] /= nc; mc[2] /= nc;
  let sc = 0; for (let i = 0; i < NC; i++) { colv[i] -= mc[i % 3]; sc += colv[i] * colv[i]; } sc = Math.sqrt(sc / NC) + 1e-3;
  const wc = WC / Math.sqrt(NC);
  for (let i = 0; i < NC; i++) out[NG + i] = (colv[i] / sc) * wc;
  // gradient magnitude of the raw grey grid
  let mm = 0, k = 0;
  for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW - 1; x++) {
    const a = Math.abs(gray[y * GW + x + 1] - gray[y * GW + x]), b = Math.abs(gray[(y + 1) * GW + x] - gray[y * GW + x]);
    mag[k] = Math.sqrt(a * a + b * b); mm += mag[k++];
  }
  mm /= NGR; let sm = 0; for (let i = 0; i < NGR; i++) sm += (mag[i] - mm) ** 2; sm = Math.sqrt(sm / NGR) + 1e-3;
  const gw = GRAD / Math.sqrt(NGR);
  for (let i = 0; i < NGR; i++) out[NG + NC + i] = ((mag[i] - mm) / sm) * gw;
  let n2 = 0; for (let i = 0; i < DIM; i++) n2 += out[i] * out[i]; const inv = 1 / (Math.sqrt(n2) + 1e-9);
  for (let i = 0; i < DIM; i++) out[i] *= inv;
  return out;
}

// legacy fixed crop: the card sits in the middle of the BW x BH buffer with MARGIN on every side
export function extract(dx, dy, ds, out = new Float32Array(DIM)) {
  const cw = IW * K, ch = IH * K;
  return extractCard(IW * R0 + dx * cw, IH * R0 + dy * ch, cw, ch, ds, out);
}

const dot = (X, row, v) => { let s = 0; const b = row * DIM; for (let j = 0; j < DIM; j++) s += X[b + j] * v[j]; return s; };
const vc = new Float32Array(DIM), vs = new Float32Array(DIM);

function recogniseWith(fill) {
  const { n, X, codes, refs } = db;
  fill(0, vc);
  // pass 1: centre crop against everything, keep the best PRE rows
  const bestIdx = new Int32Array(PRE).fill(-1), bestSc = new Float32Array(PRE).fill(-2);
  let minPos = 0, minVal = -2;
  for (let i = 0; i < n; i++) {
    const s = dot(X, i, vc);
    if (s > minVal) {
      bestIdx[minPos] = i; bestSc[minPos] = s; minVal = bestSc[0]; minPos = 0;
      for (let k = 1; k < PRE; k++) if (bestSc[k] < minVal) { minVal = bestSc[k]; minPos = k; }
    }
  }
  // pass 2: shifted / scaled crops on the candidates only
  for (let s = 1; s < SHIFTS.length; s++) {
    fill(s, vs);
    for (let k = 0; k < PRE; k++) { if (bestIdx[k] < 0) continue; const v = dot(X, bestIdx[k], vs); if (v > bestSc[k]) bestSc[k] = v; }
  }
  const order = [...Array(PRE).keys()].filter((k) => bestIdx[k] >= 0).sort((a, b) => bestSc[b] - bestSc[a]);
  const top = []; const seen = new Set();
  for (const k of order) { const c = codes[bestIdx[k]]; if (!c || seen.has(c)) continue; seen.add(c); top.push({ ref: refs[bestIdx[k]], code: c, sim: bestSc[k] }); if (top.length === 3) break; }
  if (!top.length) return { ref: null, code: null, sim: 0, margin: 0, top: [] };
  const second = top[1] ? top[1].sim : top[0].sim - 0.3;
  return { ref: top[0].ref, code: top[0].code, sim: top[0].sim, margin: top[0].sim - second, top };
}
// Call setFrame(rgba) first. Returns {ref, code, sim, margin, top:[{ref,code,sim}x3 distinct codes]}
export const recognise = () => recogniseWith((k, out) => extract(SHIFTS[k][0], SHIFTS[k][1], SHIFTS[k][2], out));
// Same, for a card at an arbitrary rectangle {cx, cy, cw, ch} of the current buffer
export const recogniseRect = (r) => recogniseWith((k, out) => extractCard(r.cx + SHIFTS[k][0] * r.cw, r.cy + SHIFTS[k][1] * r.ch, r.cw, r.ch, SHIFTS[k][2], out));

// ----- finding cards anywhere in a frame or photo -----
// A tiny neural net (public/locator.bin, trained by tools/train_locator.py) scores "is a card exactly in this window?" from the
// same fingerprint the matcher uses. Good windows are fine-aligned, then matched against the whole catalogue.
const ASPECT = 1.4;                                        // card height / width
let loc = null;
export async function loadLocator(onProgress) {
  await loadDb(onProgress);
  if (loc) return;
  const res = await fetch(import.meta.env.BASE_URL + 'locator.bin'); if (!res.ok) throw new Error('Card locator not found');
  const b = await res.arrayBuffer(), dv = new DataView(b);
  if (String.fromCharCode(...new Uint8Array(b, 0, 4)) !== 'BTL1') throw new Error('Bad card locator');
  const D = dv.getUint32(4, true), H = dv.getUint32(8, true);
  if (D !== DIM) throw new Error('Card locator does not match this app version');
  let o = 12; const f32 = (n) => { const a = new Float32Array(b.slice(o, o + n * 4)); o += n * 4; return a; };
  loc = { H, W1: f32(H * D), b1: f32(H), w2: f32(H), b2: f32(1)[0] };
}
export const locatorReady = () => !!loc && !!db;
const wv = new Float32Array(DIM);
function cardness(x, y, w) {                                // detector score for a card-shaped window (higher = more card-like)
  extractCard(x, y, w, w * ASPECT, 0, wv);
  const { H, W1, b1, w2 } = loc; let z = loc.b2;
  for (let h = 0; h < H; h++) { let a = b1[h]; const r = h * DIM; for (let j = 0; j < DIM; j++) a += W1[r + j] * wv[j]; if (a > 0) z += w2[h] * a; }
  return z;
}
const iou = (a, b) => {
  const x0 = Math.max(a.cx, b.cx), y0 = Math.max(a.cy, b.cy), x1 = Math.min(a.cx + a.cw, b.cx + b.cw), y1 = Math.min(a.cy + a.ch, b.cy + b.ch);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.cw * a.ch + b.cw * b.ch - i);
};
function nms(list, key, thr, max) {
  const out = []; for (const w of [...list].sort((a, b) => b[key] - a[key])) { if (out.length >= max) break; if (out.every((o) => iou(o, w) < thr)) out.push(w); } return out;
}
// card-shaped windows at several sizes covering the buffer [x, y, w]
export function windowsFor(w, h, { minH = 0.35, maxH = 0.95, ratio = 1.18, step = 0.22 } = {}) {
  const out = [];
  for (let f = maxH; f >= minH - 1e-6; f /= ratio) {
    const ch = h * f, cw = ch / ASPECT; if (cw > w + 1) continue;
    const nx = Math.max(1, Math.ceil((w - cw) / (cw * step)) + 1), ny = Math.max(1, Math.ceil((h - ch) / (ch * step)) + 1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push([nx === 1 ? (w - cw) / 2 : ((w - cw) * i) / (nx - 1), ny === 1 ? (h - ch) / 2 : ((h - ch) * j) / (ny - 1), cw]);
  }
  return out;
}
const around = (r, scales = [0.86, 0.93, 1, 1.08, 1.16], off = [-0.14, 0, 0.14]) => {   // windows near a previous detection
  const out = []; for (const sc of scales) { const cw = r.cw * sc, ch = cw * ASPECT, mx = r.cx + r.cw / 2, my = r.cy + r.ch / 2; for (const dy of off) for (const dx of off) out.push([mx - cw / 2 + dx * cw, my - ch / 2 + dy * ch, cw]); } return out;
};
// refine a window by hill-climbing the detector score (position and size)
function climbDet(x, y, w, d) {
  for (const st of [0.06, 0.03, 0.015]) {
    for (let it = 0; it < 3; it++) {
      let mv = null, bs = d;
      const tryIt = (a, b, c) => { const v = cardness(a, b, c); if (v > bs + 1e-3) { bs = v; mv = [a, b, c]; } };
      const hh = w * ASPECT;
      tryIt(x + st * w, y, w); tryIt(x - st * w, y, w); tryIt(x, y + st * hh, w); tryIt(x, y - st * hh, w);
      const g = 1 + st; tryIt(x - (w * (g - 1)) / 2, y - (hh * (g - 1)) / 2, w * g); tryIt(x + (w * (1 - 1 / g)) / 2, y + (hh * (1 - 1 / g)) / 2, w / g);
      if (!mv) break; [x, y, w] = mv; d = bs;
    }
  }
  return { cx: x, cy: y, cw: w, ch: w * ASPECT, d };
}
// align on the matched card itself (full fingerprint against that card's best candidates)
function align(win, rows) {
  const X = db.X; let { cx, cy, cw } = win;
  const sc = (x, y, w) => { extractCard(x, y, w, w * ASPECT, 0, wv); let b = -2; for (const r of rows) { const v = dot(X, r, wv); if (v > b) b = v; } return b; };
  let best = sc(cx, cy, cw);
  for (const st of [0.03, 0.015]) for (let it = 0; it < 3; it++) {
    let mv = null, bs = best; const hh = cw * ASPECT;
    const tryIt = (x, y, w) => { const v = sc(x, y, w); if (v > bs + 1e-4) { bs = v; mv = [x, y, w]; } };
    tryIt(cx + st * cw, cy, cw); tryIt(cx - st * cw, cy, cw); tryIt(cx, cy + st * hh, cw); tryIt(cx, cy - st * hh, cw);
    const g = 1 + st; tryIt(cx - (cw * (g - 1)) / 2, cy - (hh * (g - 1)) / 2, cw * g); tryIt(cx + (cw * (1 - 1 / g)) / 2, cy + (hh * (1 - 1 / g)) / 2, cw / g);
    if (!mv) break; [cx, cy, cw] = mv; best = bs;
  }
  return { cx, cy, cw, ch: cw * ASPECT };
}
function identify(win, d) {                                  // full catalogue match for a located card
  let r = recogniseRect(win);
  if (r.top.length) {
    const rows = r.top.map((t) => db.refs.indexOf(t.ref)).filter((i) => i >= 0);
    const a = align(win, rows), r2 = recogniseRect(a);
    if (r2.sim >= r.sim) { r = r2; win = a; }
  }
  if (r.sim < (liveMode ? 0.6 : 0.72)) {                       // the detector may have locked onto the art inside the card: try slightly larger windows
    for (const k of [1.15, 1.32, 0.88]) {
      const w2c = win.cw * k, w2 = { cx: win.cx + win.cw / 2 - w2c / 2, cy: win.cy + win.ch / 2 - (w2c * ASPECT) / 2, cw: w2c, ch: w2c * ASPECT };
      const q = recogniseRect(w2);
      if (q.sim > r.sim + 0.02) { const rows = q.top.map((t) => db.refs.indexOf(t.ref)).filter((i) => i >= 0), a = align(w2, rows), q2 = recogniseRect(a); r = q2.sim >= q.sim ? q2 : q; win = q2.sim >= q.sim ? a : w2; }
    }
  }
  r.angle = 0;
  if (srcCanvas && r.sim < ROT_BELOW && r.sim > ROT_ABOVE && d > 5 && rotBudget > 0) {            // cards are rarely held perfectly square
    for (const a of [-4, 4, -8, 8, -12, 12]) {
      rotBudget--; const q = recogniseRotated(win, a);
      if (q && q.sim > r.sim + 0.02) { q.angle = a; r = q; }
    }
  }
  r.rect = { cx: win.cx, cy: win.cy, cw: win.cw, ch: win.ch }; r.det = d; return r;
}
export let lastDebug = null;
let liveMode = false;
const ROT_BELOW = 0.82, ROT_ABOVE = 0.4; let rotBudget = 0;
const contain = (a, b) => {
  const x0 = Math.max(a.cx, b.cx), y0 = Math.max(a.cy, b.cy), x1 = Math.min(a.cx + a.cw, b.cx + b.cw), y1 = Math.min(a.cy + a.ch, b.cy + b.ch);
  return (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / Math.min(a.cw * a.ch, b.cw * b.ch);
};
export const T_DET = { live: 1.0, photo: 2.0 };              // detector thresholds (tuned from the held-out set of train_locator.py)
let liveWins = null;
// Live camera: one card. Call setBuffer() first. hint = last detection (searched locally, cheaper) or null (searched everywhere).
export function findOne(hint = null) {
  let ws;
  if (hint) ws = around(hint);
  else { if (!liveWins || liveWins.w !== IW || liveWins.h !== IH) liveWins = { w: IW, h: IH, list: windowsFor(IW, IH, { minH: 0.34, ratio: 1.17, step: 0.2 }) }; ws = liveWins.list; }
  let best = null; for (const [x, y, w] of ws) { const d = cardness(x, y, w); if (!best || d > best.d) best = { x, y, w, d }; }
  if (!best || best.d < T_DET.live) return { ref: null, code: null, sim: 0, margin: 0, top: [], det: best?.d ?? -9, lost: true };
  const win = climbDet(best.x, best.y, best.w, best.d);
  rotBudget = 2; liveMode = true;
  try { return identify(win, win.d); } finally { liveMode = false; }
}
// Photo: many cards. async so the page stays responsive; onProgress(0..1).
export async function findMany(opts = {}, onProgress) {
  const { accept = 0.58, maxCards = 80, minH = 0.16 } = opts;
  const ws = windowsFor(IW, IH, { minH, maxH: 0.95, ratio: 1.12, step: 0.14 }), cands = [];
  for (let i = 0; i < ws.length; i++) {
    const [x, y, w] = ws[i], d = cardness(x, y, w);
    if (d >= T_DET.photo) cands.push({ cx: x, cy: y, cw: w, ch: w * ASPECT, d });
    if (i % 200 === 199) { onProgress?.((i / ws.length) * 0.4); await new Promise((r) => setTimeout(r, 0)); }
  }
  const keep = nms(cands, 'd', 0.5, 240), refined = [];
  for (let i = 0; i < keep.length; i++) {
    refined.push(climbDet(keep[i].cx, keep[i].cy, keep[i].cw, keep[i].d));
    if (i % 10 === 9) { onProgress?.(0.4 + (i / keep.length) * 0.1); await new Promise((r) => setTimeout(r, 0)); }
  }
  const wins = nms(refined, 'd', 0.5, 170), found = []; rotBudget = 500;
  for (let i = 0; i < wins.length; i++) {
    const r = identify(wins[i], wins[i].d); if (r.sim >= 0.5) found.push(r);
    if (i % 3 === 2) { onProgress?.(0.5 + (i / wins.length) * 0.5); await new Promise((r2) => setTimeout(r2, 0)); }
  }
  lastDebug = { windows: wins.length, cands: cands.length, found: found.map((r) => ({ code: r.code, sim: +r.sim.toFixed(3), det: +r.det.toFixed(2), angle: r.angle, rect: [r.rect.cx, r.rect.cy, r.rect.cw, r.rect.ch].map(Math.round) })) };
  const out = [];
  for (const r of [...found].sort((a, b) => b.sim - a.sim)) {
    if (r.sim < accept || out.length >= maxCards) continue;
    if (out.every((o) => iou(o.rect, r.rect) < 0.25 && contain(o.rect, r.rect) < 0.45)) out.push(r);
  }
  onProgress?.(1);
  return out.sort((a, b) => Math.round(a.rect.cy / (a.rect.ch * 0.6)) - Math.round(b.rect.cy / (b.rect.ch * 0.6)) || a.rect.cx - b.rect.cx);
}

// ----- decision logic: accept a card after enough confident frames in a short window, re-arm when it leaves -----
export const T = { det: 7, accept: 0.64, margin: 0.08, nocard: 0.48, need: 3, minMs: 450, windowMs: 1300, absentMs: 550 };
export function makeTracker(onAdd, onState, now = () => performance.now()) {
  let hist = [], latched = null, absentSince = null, weak = 0;
  return function feed(r) {
    const t = now();
    if (r.poor) { onState({ kind: 'glare' }); return; }          // keep state; wait for a usable frame
    if (r.sim < T.nocard) {
      weak = 0; hist = [];
      if (absentSince === null) absentSince = t;
      if (t - absentSince >= T.absentMs) { latched = null; onState({ kind: 'empty' }); }
      return;
    }
    absentSince = null;
    const confident = r.sim >= T.accept && r.margin >= T.margin && (r.det == null || r.det >= T.det);
    if (latched && r.code === latched) { onState({ kind: 'done', code: latched }); return; }
    if (latched && confident) latched = null;                     // a different card was swapped in without a gap
    if (!confident) { weak++; onState({ kind: 'unsure', top: r.top, weak }); return; }   // a weak frame only adds no vote
    weak = 0;
    hist.push({ t, code: r.code, ref: r.ref, sim: r.sim, margin: r.margin, det: r.det });
    hist = hist.filter((h) => t - h.t <= T.windowMs);
    const mine = hist.filter((h) => h.code === r.code), others = hist.length - mine.length;
    onState({ kind: 'seeing', code: r.code, n: mine.length });
    if (mine.length >= T.need && t - mine[0].t >= T.minMs && others * 3 <= mine.length) {
      const votes = {}; for (const h of mine) votes[h.ref] = (votes[h.ref] || 0) + 1;
      const ref = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      const info = { sim: mine.reduce((a, h) => a + h.sim, 0) / mine.length, min: Math.min(...mine.map((h) => h.sim)), margin: r.margin, det: Math.min(...mine.map((h) => h.det ?? 99)) };
      latched = r.code; hist = []; onAdd(r.code, ref, info);
    }
  };
}
