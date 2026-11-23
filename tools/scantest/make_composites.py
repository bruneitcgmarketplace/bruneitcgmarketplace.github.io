"""Makes test photos for the gallery scanner: cards placed on a table-like background, with rotation, blur and lighting.
Writes tools/scantest/photos/*.jpg and photos/truth.json (card codes per photo).  Run with Python that has pillow + numpy."""
import json, math, os, random
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__)); CAT = os.path.join(HERE, 'cat'); OUT = os.path.join(HERE, 'photos'); os.makedirs(OUT, exist_ok=True)
cat = json.load(open(os.path.join(HERE, '..', '..', 'public', 'catalog.json'), encoding='utf-8'))['cards']
by_file = {}
for c in cat:
    f = f'{c[1]}-{c[0]}.jpg'
    if os.path.exists(os.path.join(CAT, f)) and c[4] not in ('DON',): by_file[f] = c[2]
files = sorted(by_file)
rnd = random.Random(7)

def bg(w, h, kind):
    base = {'wood': (122, 86, 54), 'mat': (28, 34, 60), 'white': (226, 224, 218), 'grey': (96, 98, 102)}[kind]
    a = np.zeros((h, w, 3), np.float32) + np.array(base, np.float32)
    yy, xx = np.mgrid[0:h, 0:w]; a *= (0.85 + 0.3 * (xx / w))[..., None]
    a += np.random.default_rng(1).normal(0, 6, a.shape)
    if kind == 'wood': a *= (0.92 + 0.08 * np.sin(yy / 5.0 + np.sin(xx / 90.0) * 3))[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def place(canvas, f, cx, cy, ch, ang, shadow=True):
    im = Image.open(os.path.join(CAT, f)).convert('RGB'); cw = int(ch / 1.4); im = im.resize((cw, int(ch)), Image.LANCZOS)
    pad = Image.new('RGBA', (cw + 6, int(ch) + 6), (0, 0, 0, 0)); pad.paste(im, (3, 3))
    if shadow:
        sh = Image.new('RGBA', pad.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 110), (6, 6, cw + 6, int(ch) + 6)); sh = sh.filter(ImageFilter.GaussianBlur(5)); sh = sh.rotate(ang, expand=True, resample=Image.BICUBIC)
        canvas.paste(sh, (int(cx - sh.width / 2) + 4, int(cy - sh.height / 2) + 6), sh)
    r = pad.rotate(ang, expand=True, resample=Image.BICUBIC)
    canvas.paste(r, (int(cx - r.width / 2), int(cy - r.height / 2)), r)
    return (cx, cy, cw, ch)

def finish(img, blur, bright, name, rot=0):
    img = img.filter(ImageFilter.GaussianBlur(blur)); img = ImageEnhance.Brightness(img).enhance(bright)
    if rot: img = img.rotate(rot, expand=True)
    img.save(os.path.join(OUT, name), quality=88)

truth = {}
def pick(n): return [rnd.choice(files) for _ in range(n)]

# A: single card, off centre, tilted
for k, (kind, ch, ang, bl, br) in enumerate([('wood', 560, 4, 0.8, 1.0), ('mat', 420, -6, 1.2, 0.85), ('white', 640, 2, 0.6, 1.1)]):
    c = bg(1200, 900, kind); f = pick(1)[0]; place(c, f, rnd.randint(480, 760), rnd.randint(380, 500), ch, ang); finish(c, bl, br, f'single{k}.jpg'); truth[f'single{k}.jpg'] = [by_file[f]]
# B: 3x3 binder page with gaps
c = bg(1200, 900, 'grey'); fs = pick(9); i = 0
for r in range(3):
    for q in range(3): place(c, fs[i], 330 + q * 270, 170 + r * 280, 252, rnd.uniform(-1.5, 1.5)); i += 1
finish(c, 0.8, 1.0, 'grid3x3.jpg'); truth['grid3x3.jpg'] = [by_file[f] for f in fs]
# C: scattered cards of mixed sizes, no overlap
c = bg(1400, 1000, 'wood'); fs = []; boxes = []
for _ in range(400):
    if len(fs) == 10: break
    ch = rnd.randint(250, 340); cx, cy = rnd.randint(150, 1250), rnd.randint(190, 810)
    if any(abs(cx - x) < (ch + h) * 0.5 * 0.8 and abs(cy - y) < (ch + h) * 0.5 * 0.95 for x, y, h in boxes): continue
    f = pick(1)[0]; place(c, f, cx, cy, ch, rnd.uniform(-7, 7)); boxes.append((cx, cy, ch)); fs.append(f)
finish(c, 1.0, 0.95, 'scatter10.jpg'); truth['scatter10.jpg'] = [by_file[f] for f in fs]
# D: tight 4x3 grid (touching)
c = bg(1300, 800, 'mat'); fs = pick(12); i = 0
for r in range(2):
    for q in range(6): place(c, fs[i], 120 + q * 212, 210 + r * 300, 290, 0, shadow=False); i += 1
finish(c, 0.9, 1.0, 'tight12.jpg'); truth['tight12.jpg'] = [by_file[f] for f in fs]
json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w'), indent=1)
print({k: len(v) for k, v in truth.items()})
