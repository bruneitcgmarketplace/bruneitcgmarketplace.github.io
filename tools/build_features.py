"""Builds public/features-1.bin and features-2.bin: a compact art fingerprint for every catalogue card, used by the Scan tab
to recognise a card from the camera in real time (no OCR). Also reports accuracy under camera-like
augmentation and the similarity statistics used to set the scanner thresholds.

Needs: Python with pillow + numpy; card images in tools/scantest/cat (run tools/scantest/dl.py first).
Run:   python tools/build_features.py            (about 1 min)
Layout (features-1.bin followed by features-2.bin, concatenated): 'BTF1' | uint32 n | uint32 dim | float32 scale | int8[n*dim]   (little endian)
Row i corresponds to catalog.json cards[i] (file order). Rows of cards without an image are all zero.
The JS side (src/views/scan.js, extractFeatures) must stay identical to feat_v below.
"""
import json, os, random, struct, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'scantest'))
import feat as F  # augmentation helpers (camera simulation)

G, C, WC, GRAD, HP = (16, 22), (6, 8), 0.6, 0.5, 3   # HP: high-pass window radius (grey cells)
INSET = (0.04, 0.03)
SCALE = 400.0
SHIFTS = [(0, 0, 0), (0.02, 0, 0), (-0.02, 0, 0), (0, 0.02, 0), (0, -0.02, 0), (0, 0, 0.02), (0, 0, -0.02), (0.02, 0.02, 0), (-0.02, -0.02, 0)]


def feat_v(im, dx=0.0, dy=0.0, ds=0.0):
    w, h = im.size
    ix, iy = INSET[0] + ds, INSET[1] + ds
    box = (w * (ix + dx), h * (iy + dy), w * (1 - ix + dx), h * (1 - iy + dy))
    im2 = im.crop(tuple(int(round(v)) for v in box))
    gray = np.asarray(im2.convert('L').resize(G, Image.BOX), dtype=np.float32)
    # high-pass: subtract the local mean over a (2*HP+1)^2 window (edge cells use the valid part). Removes glare / uneven light.
    hh, ww = gray.shape; low = np.zeros_like(gray)
    for y in range(hh):
        for x in range(ww):
            low[y, x] = gray[max(0, y - HP):y + HP + 1, max(0, x - HP):x + HP + 1].mean()
    gv = (gray - low).ravel(); gv = (gv - gv.mean()) / (gv.std() + 1e-3)
    col = np.asarray(im2.resize(C, Image.BOX), dtype=np.float32).reshape(-1, 3)
    col = col - col.mean(0, keepdims=True); col = (col / (col.std() + 1e-3)).ravel()
    gx = np.abs(np.diff(gray, axis=1))[:-1, :]; gy = np.abs(np.diff(gray, axis=0))[:, :-1]
    m = np.sqrt(gx ** 2 + gy ** 2).ravel(); m = (m - m.mean()) / (m.std() + 1e-3)
    v = np.concatenate([gv / np.sqrt(len(gv)), WC * col / np.sqrt(len(col)), GRAD * m / np.sqrt(len(m))])
    return (v / (np.linalg.norm(v) + 1e-9)).astype(np.float32)


def main():
    cat = json.load(open(os.path.join(HERE, '../public/catalog.json'), encoding='utf-8'))['cards']
    refs = [f'{r[1]}-{r[0]}' for r in cat]; codes = [r[2] for r in cat]
    dim = len(feat_v(Image.new('RGB', (200, 280))))
    X = np.zeros((len(cat), dim), dtype=np.float32); ok = np.zeros(len(cat), dtype=bool)
    for i, ref in enumerate(refs):
        f = os.path.join(HERE, 'scantest', 'cat', ref + '.jpg')
        try:
            if os.path.getsize(f) < 2000: raise OSError
            X[i] = feat_v(Image.open(f).convert('RGB')); ok[i] = True
        except Exception:
            pass
    print('cards', len(cat), 'with image', int(ok.sum()), 'dim', dim)
    q = np.clip(np.round(X * SCALE), -127, 127).astype(np.int8)
    blob = b'BTF1' + struct.pack('<IIf', len(cat), dim, SCALE) + q.tobytes()
    half = len(blob) // 2           # two files: keeps each commit/upload under size limits
    for name in ('features.bin',):
        old = os.path.join(HERE, '../public', name)
        if os.path.exists(old): os.remove(old)
    for k, part in enumerate((blob[:half], blob[half:]), 1):
        with open(os.path.join(HERE, f'../public/features-{k}.bin'), 'wb') as fh: fh.write(part)
    print('features-1.bin + features-2.bin', len(blob) // 1024, 'KB total')
    Xd = q.astype(np.float32) / SCALE
    Xd /= (np.linalg.norm(Xd, axis=1, keepdims=True) + 1e-9)

    # --- accuracy + similarity statistics on the dequantised database
    rng = random.Random(5)
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    idx = [i for i in (rng.randrange(len(cat)) for _ in range(n)) if ok[i]]
    hit1 = hit3 = exact = 0; s1s = []; margins = []
    for i in idx:
        im = F.augment(Image.open(os.path.join(HERE, 'scantest', 'cat', refs[i] + '.jpg')).convert('RGB'), rng)
        s = np.max([Xd @ feat_v(im, *d) for d in SHIFTS], axis=0)
        o = np.argsort(-s)[:80]
        best = o[0]
        second = next((k for k in o[1:] if codes[k] != codes[best]), o[-1])
        hit1 += codes[best] == codes[i]; hit3 += any(codes[k] == codes[i] for k in o[:3]); exact += best == i
        s1s.append(float(s[best])); margins.append(float(s[best] - s[second]))
    m = len(idx)
    print(f'accuracy over {m}: exact={exact / m:.3f} code@1={hit1 / m:.3f} code@3(top3 rows)={hit3 / m:.3f}')
    pct = lambda a, p: float(np.percentile(a, p))
    print('top similarity (true cards) p5/p25/p50:', round(pct(s1s, 5), 3), round(pct(s1s, 25), 3), round(pct(s1s, 50), 3))
    print('margin to 2nd distinct code p5/p25/p50:', round(pct(margins, 5), 3), round(pct(margins, 25), 3), round(pct(margins, 50), 3))
    # negatives: empty table / wall / noise / zoomed or partial card
    negs = []
    for k in range(60):
        base = rng.choice(['flat', 'grad', 'noise', 'zoom'])
        if base == 'flat': a = np.full((420, 300, 3), rng.randint(30, 220), np.uint8)
        elif base == 'grad':
            yy, xx = np.mgrid[0:420, 0:300]; a = np.stack([(xx / 300 * rng.randint(60, 255) + yy / 420 * rng.randint(0, 120)) % 256] * 3, -1).astype(np.uint8)
        elif base == 'noise': a = np.random.default_rng(k).integers(0, 255, (420, 300, 3), dtype=np.uint8)
        else:
            c = Image.open(os.path.join(HERE, 'scantest', 'cat', refs[rng.choice(idx)] + '.jpg')).convert('RGB'); w, h = c.size
            a = np.asarray(c.crop((int(w * .35), int(h * .3), int(w * .75), int(h * .7))).resize((300, 420)))
        negs.append(Image.fromarray(a))
    ns = [float(np.max([Xd @ feat_v(im, *d) for d in SHIFTS], axis=0).max()) for im in negs]
    print('top similarity (no card / partial) p50/p95/max:', round(pct(ns, 50), 3), round(pct(ns, 95), 3), round(max(ns), 3))


if __name__ == '__main__':
    main()
