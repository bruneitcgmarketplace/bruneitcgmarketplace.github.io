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

// ----- integral images over the capture buffer -----
const W1 = BW + 1;
const iL = new Float64Array(W1 * (BH + 1)), iR = new Float64Array(W1 * (BH + 1)), iG = new Float64Array(W1 * (BH + 1)), iB = new Float64Array(W1 * (BH + 1));
export function setFrame(rgba) {
  let sat = 0, tot = 0;
  for (let y = 0; y < BH; y++) {
    let sl = 0, sr = 0, sg = 0, sb = 0;
    for (let x = 0; x < BW; x++) {
      const p = (y * BW + x) * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b; sl += lum; sr += r; sg += g; sb += b; tot += lum; if (lum > 240) sat++;
      const i = (y + 1) * W1 + x + 1, u = y * W1 + x + 1;
      iL[i] = iL[u] + sl; iR[i] = iR[u] + sr; iG[i] = iG[u] + sg; iB[i] = iB[u] + sb;
    }
  }
  const mean = tot / (BW * BH), satFrac = sat / (BW * BH);
  return { mean, sat: satFrac, poor: satFrac > 0.3 || mean < 25 };   // blown-out glare or too dark: do not trust matches
}
function box(ii, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.min(BW - 1, Math.round(x0))); y0 = Math.max(0, Math.min(BH - 1, Math.round(y0)));
  x1 = Math.max(x0 + 1, Math.min(BW, Math.round(x1))); y1 = Math.max(y0 + 1, Math.min(BH, Math.round(y1)));
  return (ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
}
const hp = new Float32Array(NG), gray = new Float32Array(NG), colv = new Float32Array(NC), mag = new Float32Array(NGR);
export function extract(dx, dy, ds, out = new Float32Array(DIM)) {
  const ix = INSET[0] + ds, iy = INSET[1] + ds;
  const bx0 = BW * (R0 + (ix + dx) * K), bx1 = BW * (R0 + (1 - ix + dx) * K), by0 = BH * (R0 + (iy + dy) * K), by1 = BH * (R0 + (1 - iy + dy) * K);
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

const dot = (X, row, v) => { let s = 0; const b = row * DIM; for (let j = 0; j < DIM; j++) s += X[b + j] * v[j]; return s; };
const vc = new Float32Array(DIM), vs = new Float32Array(DIM);

// Call setFrame(rgba) first. Returns {ref, code, sim, margin, top:[{ref,code,sim}x3 distinct codes]}
export function recognise() {
  const { n, X, codes, refs } = db;
  extract(0, 0, 0, vc);
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
    extract(SHIFTS[s][0], SHIFTS[s][1], SHIFTS[s][2], vs);
    for (let k = 0; k < PRE; k++) { if (bestIdx[k] < 0) continue; const v = dot(X, bestIdx[k], vs); if (v > bestSc[k]) bestSc[k] = v; }
  }
  const order = [...Array(PRE).keys()].filter((k) => bestIdx[k] >= 0).sort((a, b) => bestSc[b] - bestSc[a]);
  const top = []; const seen = new Set();
  for (const k of order) { const c = codes[bestIdx[k]]; if (!c || seen.has(c)) continue; seen.add(c); top.push({ ref: refs[bestIdx[k]], code: c, sim: bestSc[k] }); if (top.length === 3) break; }
  if (!top.length) return { ref: null, code: null, sim: 0, margin: 0, top: [] };
  const second = top[1] ? top[1].sim : top[0].sim - 0.3;
  return { ref: top[0].ref, code: top[0].code, sim: top[0].sim, margin: top[0].sim - second, top };
}

// ----- decision logic: accept a card after enough confident frames in a short window, re-arm when it leaves -----
export const T = { accept: 0.6, margin: 0.05, nocard: 0.48, need: 3, minMs: 450, windowMs: 1300, absentMs: 550 };
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
    const confident = r.sim >= T.accept && r.margin >= T.margin;
    if (latched && r.code === latched) { onState({ kind: 'done', code: latched }); return; }
    if (latched && confident) latched = null;                     // a different card was swapped in without a gap
    if (!confident) { weak++; onState({ kind: 'unsure', top: r.top, weak }); return; }   // a weak frame only adds no vote
    weak = 0;
    hist.push({ t, code: r.code, ref: r.ref, sim: r.sim, margin: r.margin });
    hist = hist.filter((h) => t - h.t <= T.windowMs);
    const mine = hist.filter((h) => h.code === r.code), others = hist.length - mine.length;
    onState({ kind: 'seeing', code: r.code, n: mine.length });
    if (mine.length >= T.need && t - mine[0].t >= T.minMs && others * 3 <= mine.length) {
      const votes = {}; for (const h of mine) votes[h.ref] = (votes[h.ref] || 0) + 1;
      const ref = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      const info = { sim: mine.reduce((a, h) => a + h.sim, 0) / mine.length, min: Math.min(...mine.map((h) => h.sim)), margin: r.margin };
      latched = r.code; hist = []; onAdd(r.code, ref, info);
    }
  };
}
