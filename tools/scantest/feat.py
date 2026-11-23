"""Card-art fingerprint experiments: build features for every catalogue image, then query with
camera-like augmentations (warp, lighting, blur, noise, glare) and measure top-1 accuracy."""
import json, os, sys, random, math
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
cat = json.load(open(os.path.join(HERE, '../../public/catalog.json'), encoding='utf-8'))['cards']
REFS = [f'{r[1]}-{r[0]}' for r in cat]
CODES = [r[2] for r in cat]

MISSING = set()
G = (16, 22)   # grayscale grid (w, h)
C = (6, 8)     # colour grid
INSET = (0.04, 0.03)


def feat(im, g=G, c=C, wc=0.6):
    """im: PIL RGB card image (any size, aspect ~5:7). Returns a float32 vector (unit norm)."""
    w, h = im.size
    box = (w * INSET[0], h * INSET[1], w * (1 - INSET[0]), h * (1 - INSET[1]))
    im = im.crop(tuple(int(round(v)) for v in box))
    gray = np.asarray(im.convert('L').resize(g, Image.BOX), dtype=np.float32).ravel()
    gray = (gray - gray.mean()) / (gray.std() + 1e-3)
    col = np.asarray(im.resize(c, Image.BOX), dtype=np.float32).reshape(-1, 3)
    col = col - col.mean(axis=0, keepdims=True)           # remove global colour cast
    col = col / (col.std() + 1e-3)
    col = col.ravel()
    v = np.concatenate([gray / math.sqrt(len(gray)), wc * col / math.sqrt(len(col))])
    return (v / (np.linalg.norm(v) + 1e-9)).astype(np.float32)


def augment(im, rng):
    W, H = 300, 420                                       # simulated camera crop of the guide box
    canvas = Image.new('RGB', (W, H), tuple(rng.randint(60, 200) for _ in range(3)))
    sc = rng.uniform(0.92, 1.04)
    cw, ch = int(W * sc * 0.96), int(H * sc * 0.96)
    card = im.resize((cw, ch), Image.BILINEAR)
    ox = int((W - cw) / 2 + rng.uniform(-0.03, 0.03) * W)
    oy = int((H - ch) / 2 + rng.uniform(-0.03, 0.03) * H)
    canvas.paste(card, (ox, oy))
    j = 0.025
    def jit(x, y): return (x + rng.uniform(-j, j) * W, y + rng.uniform(-j, j) * H)
    quad = [jit(0, 0), jit(0, H), jit(W, H), jit(W, 0)]
    canvas = canvas.transform((W, H), Image.QUAD, sum(quad, ()), Image.BILINEAR)
    canvas = canvas.rotate(rng.uniform(-3, 3), resample=Image.BILINEAR, fillcolor=(120, 120, 120))
    a = np.asarray(canvas, dtype=np.float32)
    a = a * rng.uniform(0.7, 1.3) + rng.uniform(-20, 20)
    a = (a - 128) * rng.uniform(0.8, 1.25) + 128
    a = a * np.array([rng.uniform(0.92, 1.08) for _ in range(3)])
    if rng.random() < 0.3:                                # glare band
        yy, xx = np.mgrid[0:H, 0:W]
        d = (xx / W * 0.7 + yy / H * 0.7) - rng.uniform(0.3, 1.1)
        a += (np.exp(-(d ** 2) / 0.01) * rng.uniform(40, 110))[..., None]
    a += np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, 4, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    r = rng.uniform(0, 1.4)
    return out.filter(ImageFilter.GaussianBlur(r)) if r > 0.3 else out


def load_db(**kw):
    X = np.zeros((len(cat), len(feat(Image.new('RGB', (200, 280)), **kw))), dtype=np.float32)
    for i, ref in enumerate(REFS):
        f = os.path.join(HERE, 'cat', ref + '.jpg')
        try: X[i] = feat(Image.open(f).convert('RGB'), **kw)
        except Exception: MISSING.add(i)   # no catalogue image (rare); excluded from matching
    return X


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    rng = random.Random(11)
    configs = {'gray16x22': dict(g=(16, 22), c=(6, 8), wc=0.0), 'g16x22+col6x8': dict(g=(16, 22), c=(6, 8), wc=0.6),
               'g24x34+col6x8': dict(g=(24, 34), c=(6, 8), wc=0.6), 'g12x16+col4x6': dict(g=(12, 16), c=(4, 6), wc=0.6)}
    MISSING_PRE = set(i for i, ref in enumerate(REFS) if os.path.getsize(os.path.join(HERE, 'cat', ref + '.jpg')) < 2000)
    idx = [i for i in (rng.randrange(len(cat)) for _ in range(n)) if i not in MISSING_PRE]
    n = len(idx)
    queries = [augment(Image.open(os.path.join(HERE, 'cat', REFS[i] + '.jpg')).convert('RGB'), rng) for i in idx]
    for name, kw in configs.items():
        X = load_db(**kw)
        top1 = top1code = top3code = 0
        for i, q in zip(idx, queries):
            s = X @ feat(q, **kw)
            order = np.argsort(-s)[:3]
            top1 += order[0] == i
            top1code += CODES[order[0]] == CODES[i]
            top3code += any(CODES[o] == CODES[i] for o in order)
        print(f'{name:16s} dims={X.shape[1]:4d} exact={top1 / n:.3f} code@1={top1code / n:.3f} code@3={top3code / n:.3f}')
