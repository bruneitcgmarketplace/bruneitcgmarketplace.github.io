"""Trains the 'is a card exactly here?' detector used by the Scan tab to find cards in camera frames and photos.
It is a tiny neural net on the same 811-number fingerprint the matcher uses, so it costs almost nothing per window.
Positives: windows closely aligned with a card in a synthetic photo. Negatives: table, partial cards, shifted / rescaled windows.
Output: public/locator.bin   'BTL1' | uint32 dim | uint32 hidden | float32 W1[hidden*dim] | float32 b1[hidden] | float32 w2[hidden] | float32 b2
Run: python tools/train_locator.py [scenes=700]     (needs numpy + pillow; card images in tools/scantest/cat)
"""
import json, math, os, random, struct, sys, time
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from build_features import feat_v  # same fingerprint as the matcher

CAT = os.path.join(HERE, 'scantest', 'cat')
cat = json.load(open(os.path.join(HERE, '..', 'public', 'catalog.json'), encoding='utf-8'))['cards']
files = [f'{c[1]}-{c[0]}.jpg' for c in cat if os.path.exists(os.path.join(CAT, f'{c[1]}-{c[0]}.jpg')) and os.path.getsize(os.path.join(CAT, f'{c[1]}-{c[0]}.jpg')) > 2000]
rnd = random.Random(11); nrng = np.random.default_rng(3)
NS = int(sys.argv[1]) if len(sys.argv) > 1 else 700
SW, SH = 640, 480

def background():
    kind = rnd.choice(['wood', 'mat', 'white', 'grey', 'felt', 'cloth'])
    base = {'wood': (122, 86, 54), 'mat': (28, 34, 60), 'white': (226, 224, 218), 'grey': (96, 98, 102), 'felt': (20, 90, 60), 'cloth': (150, 40, 50)}[kind]
    base = np.array(base, np.float32) * rnd.uniform(0.75, 1.2)
    yy, xx = np.mgrid[0:SH, 0:SW]; a = np.zeros((SH, SW, 3), np.float32) + base
    a *= (0.8 + 0.4 * (xx * rnd.random() + yy * rnd.random()) / (SW + SH))[..., None]
    a += nrng.normal(0, rnd.uniform(3, 10), a.shape)
    if kind in ('wood', 'cloth'): a *= (0.9 + 0.1 * np.sin(yy / rnd.uniform(3, 9) + np.sin(xx / rnd.uniform(40, 120)) * 3))[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGBA')

def iou(a, b):
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    i = max(0, x1 - x0) * max(0, y1 - y0); return i / (a[2] * a[3] + b[2] * b[3] - i)

def scene():
    bg = background(); rects = []
    for _ in range(rnd.randint(1, 7)):
        for _try in range(30):
            ch = rnd.uniform(90, 360); cw = ch / 1.4; cx = rnd.uniform(cw / 2 + 8, SW - cw / 2 - 8); cy = rnd.uniform(ch / 2 + 8, SH - ch / 2 - 8)
            r = (cx - cw / 2, cy - ch / 2, cw, ch)
            if all(iou(r, o) < 0.02 for o in rects): break
        else: continue
        im = Image.open(os.path.join(CAT, rnd.choice(files))).convert('RGB').resize((int(cw), int(ch)), Image.Resampling.LANCZOS)
        ang = max(-14, min(14, rnd.gauss(0, 5.5)))
        pad = Image.new('RGBA', (int(cw) + 8, int(ch) + 8), (0, 0, 0, 0)); pad.paste(im, (4, 4))
        if rnd.random() < 0.7:
            sh = Image.new('RGBA', pad.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 100), (7, 7, int(cw) + 7, int(ch) + 7)); sh = sh.filter(ImageFilter.GaussianBlur(5)).rotate(ang, expand=True, resample=Image.Resampling.BICUBIC)
            bg.paste(sh, (int(cx - sh.width / 2) + 3, int(cy - sh.height / 2) + 5), sh)
        rot = pad.rotate(ang, expand=True, resample=Image.Resampling.BICUBIC); bg.paste(rot, (int(cx - rot.width / 2), int(cy - rot.height / 2)), rot)
        rects.append(r)
    img = bg.convert('RGB')
    img = img.filter(ImageFilter.GaussianBlur(rnd.uniform(0.3, 1.6)))
    img = ImageEnhance.Brightness(img).enhance(rnd.uniform(0.55, 1.3)); img = ImageEnhance.Contrast(img).enhance(rnd.uniform(0.8, 1.2))
    a = np.asarray(img, np.float32)
    if rnd.random() < 0.3:  # glare / uneven light
        gx, gy = rnd.uniform(0, SW), rnd.uniform(0, SH); yy, xx = np.mgrid[0:SH, 0:SW]
        a += (rnd.uniform(40, 110) * np.exp(-(((xx - gx) / rnd.uniform(60, 200)) ** 2 + ((yy - gy) / rnd.uniform(60, 200)) ** 2)))[..., None]
    a += nrng.normal(0, rnd.uniform(0, 5), a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), rects

def feat_window(img, w):
    x, y, ww, hh = w
    if x < 0 or y < 0 or x + ww > SW or y + hh > SH or ww < 40: return None
    return feat_v(img.crop((int(round(x)), int(round(y)), int(round(x + ww)), int(round(y + hh)))))

X, Y, G = [], [], []
t0 = time.time()
for s in range(NS):
    img, rects = scene()
    if not rects: continue
    def add(w, y):
        v = feat_window(img, w)
        if v is not None: X.append(v); Y.append(y); G.append(s)
    for r in rects:
        for _ in range(7):                                  # positives: tightly aligned
            sc = math.exp(rnd.gauss(0, 0.025)); cw = r[2] * sc; ch = r[3] * sc
            w = (r[0] + r[2] / 2 - cw / 2 + rnd.gauss(0, 0.02) * r[2], r[1] + r[3] / 2 - ch / 2 + rnd.gauss(0, 0.02) * r[3], cw, ch)
            if iou(w, r) > 0.8: add(w, 1)
        for _ in range(9):                                  # hard negatives: same card, wrong place or size
            sc = math.exp(rnd.choice([-1, 1]) * rnd.uniform(0.07, 0.5)) if rnd.random() < 0.7 else 1.0
            cw = r[2] * sc; ch = r[3] * sc; ang = rnd.uniform(0, 2 * math.pi); d = rnd.uniform(0.08, 0.6)
            w = (r[0] + r[2] / 2 - cw / 2 + math.cos(ang) * d * r[2], r[1] + r[3] / 2 - ch / 2 + math.sin(ang) * d * r[3], cw, ch)
            if all(iou(w, o) < 0.6 for o in rects): add(w, 0)
    for _ in range(14):                                     # random windows
        ch = math.exp(rnd.uniform(math.log(80), math.log(440))); w = (rnd.uniform(0, SW - ch / 1.4), rnd.uniform(0, SH - ch), ch / 1.4, ch)
        if all(iou(w, o) < 0.5 for o in rects): add(w, 0)
    if s % 50 == 49: print(f'scene {s + 1}/{NS}  samples {len(X)}  pos {sum(Y)}  {time.time() - t0:.0f}s', flush=True)
X = np.array(X, np.float32); Y = np.array(Y, np.float32); G = np.array(G)
print('samples', len(X), 'positives', int(Y.sum()))
test = G % 10 == 0; tr = ~test
D = X.shape[1]; H = 64; SC = math.sqrt(D)
Xs = X * SC

def sigmoid(z): return 1 / (1 + np.exp(-np.clip(z, -30, 30)))
def auc(s, y):
    o = np.argsort(s); r = np.empty(len(s)); r[o] = np.arange(len(s)); n1 = y.sum(); n0 = len(y) - n1
    return (r[y == 1].sum() - n1 * (n1 - 1) / 2) / (n1 * n0)

# MLP D -> H (relu) -> 1, Adam, class-balanced
rng = np.random.default_rng(0)
W1 = rng.normal(0, math.sqrt(2 / D), (D, H)).astype(np.float32); b1 = np.zeros(H, np.float32); w2 = rng.normal(0, 0.1, H).astype(np.float32); b2 = np.float32(0)
params = [W1, b1, w2]; m = [np.zeros_like(p) for p in params]; v = [np.zeros_like(p) for p in params]; mb = vb = 0.0
Xtr, Ytr = Xs[tr], Y[tr]; wpos = (len(Ytr) - Ytr.sum()) / Ytr.sum(); lr = 2e-3; step = 0
for ep in range(40):
    idx = rng.permutation(len(Xtr)); tot = 0
    for i in range(0, len(idx), 256):
        b = idx[i:i + 256]; xb, yb = Xtr[b], Ytr[b]
        h = np.maximum(0, xb @ W1 + b1); p = sigmoid(h @ w2 + b2)
        wgt = np.where(yb == 1, wpos ** 0.5, 1.0); g = (p - yb) * wgt / len(b); tot += float(-(wgt * (yb * np.log(p + 1e-7) + (1 - yb) * np.log(1 - p + 1e-7))).sum())
        gw2 = h.T @ g + 1e-4 * w2; gb2 = g.sum(); gh = np.outer(g, w2) * (h > 0); gW1 = xb.T @ gh + 1e-4 * W1; gb1 = gh.sum(0)
        step += 1
        for k, (pp, gg) in enumerate(zip(params, [gW1, gb1, gw2])):
            m[k] = 0.9 * m[k] + 0.1 * gg; v[k] = 0.999 * v[k] + 0.001 * gg * gg
            pp -= lr * (m[k] / (1 - 0.9 ** step)) / (np.sqrt(v[k] / (1 - 0.999 ** step)) + 1e-8)
        mb = 0.9 * mb + 0.1 * gb2; vb = 0.999 * vb + 0.001 * gb2 * gb2; b2 -= lr * (mb / (1 - 0.9 ** step)) / (math.sqrt(vb / (1 - 0.999 ** step)) + 1e-8)
    if ep % 5 == 4 or ep == 39:
        zt = np.maximum(0, Xs[test] @ W1 + b1) @ w2 + b2
        print(f'epoch {ep + 1} loss {tot / len(idx):.4f}  held-out AUC {auc(zt, Y[test]):.4f}', flush=True)
    if ep == 24: lr = 6e-4
z = np.maximum(0, Xs[test] @ W1 + b1) @ w2 + b2
for thr in (-1, 0, 1, 2, 3):
    print(f'thr {thr:>2}: positives kept {np.mean(z[Y[test] == 1] > thr):.3f}   negatives passed {np.mean(z[Y[test] == 0] > thr):.4f}')
out = os.path.join(HERE, '..', 'public', 'locator.bin')
with open(out, 'wb') as f:
    f.write(b'BTL1' + struct.pack('<II', D, H)); f.write((W1.T * SC).astype('<f4').tobytes()); f.write(b1.astype('<f4').tobytes()); f.write(w2.astype('<f4').tobytes()); f.write(struct.pack('<f', float(b2)))
print('wrote public/locator.bin', os.path.getsize(out) // 1024, 'KB')
