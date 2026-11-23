import json, os, sys, urllib.request, concurrent.futures as cf, time
c=json.load(open('../../public/catalog.json',encoding='utf-8'))['cards']
os.makedirs('cat',exist_ok=True)
def get(r):
    num,set_=r[0],r[1]; f=f'cat/{set_}-{num}.jpg'
    if os.path.exists(f) and os.path.getsize(f)>1000: return True
    for a in range(3):
        try:
            req=urllib.request.Request(f'https://card.yuyu-tei.jp/opc/200_280/{set_}/{num}.jpg',headers={'User-Agent':'Mozilla/5.0'})
            open(f,'wb').write(urllib.request.urlopen(req,timeout=20).read()); return True
        except Exception as e: time.sleep(1+a)
    return False
t=time.time()
with cf.ThreadPoolExecutor(8) as ex: res=list(ex.map(get,c))
print(sum(res),'of',len(res),'in',round(time.time()-t),'s')
