"""Rebuild local product photos from the checked-in provenance manifest.
Requires Pillow. Never invent package art or substitute another set's image.
"""
import argparse, concurrent.futures, hashlib, io, json, pathlib, urllib.request
from PIL import Image, ImageChops, ImageOps, ImageDraw
ROOT = pathlib.Path(__file__).resolve().parents[1]

def normalize(raw):
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGBA')
    white = Image.new('RGBA', im.size, 'white'); white.alpha_composite(im)
    im = white.convert('RGB')
    # Remove connected plain light backdrops; never crop or stretch the packaging.
    corners = [(0,0),(im.width-1,0),(0,im.height-1),(im.width-1,im.height-1)]
    for xy in corners:
        px = im.getpixel(xy)
        assert isinstance(px, tuple)
        if min(px) > 185 and max(px)-min(px) < 45 and min(px) < 248:
            ImageDraw.floodfill(im, xy, (255,255,255), thresh=24)
    diff = ImageChops.difference(im, Image.new('RGB', im.size, 'white')).convert('L')
    bbox = diff.point([255 if v > 22 else 0 for v in range(256)]).getbbox()
    if bbox: im = im.crop(bbox)
    im.thumbnail((332,340), Image.Resampling.LANCZOS)
    canvas = Image.new('RGB',(400,400),'white')
    canvas.paste(im,((400-im.width)//2,(400-im.height)//2))
    return canvas

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--sources',type=pathlib.Path,default=ROOT/'public/sets/sources.json');ap.add_argument('--cache',type=pathlib.Path,required=True);args=ap.parse_args()
    sources=json.loads(args.sources.read_text(encoding='utf-8'));args.cache.mkdir(parents=True,exist_ok=True)
    out=ROOT/'public/sets';out.mkdir(exist_ok=True)
    def build(kv):
        k,s=kv;url=s['image_url'];cache=args.cache/(hashlib.sha256(url.encode()).hexdigest()+'.img')
        if not cache.exists():
            req=urllib.request.Request(url,headers={'User-Agent':'BruneiTCG-product-photo-import/1.0'})
            cache.write_bytes(urllib.request.urlopen(req,timeout=40).read())
        im=normalize(cache.read_bytes());im.save(out/(k+'.webp'),'WEBP',quality=88,method=6)
        return k,(out/(k+'.webp')).stat().st_size
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex: results=list(ex.map(build,sources.items()))
    print(json.dumps({'count':len(results),'total_bytes':sum(n for k,n in results),'sets':[k for k,n in results]}))
if __name__=='__main__':main()
