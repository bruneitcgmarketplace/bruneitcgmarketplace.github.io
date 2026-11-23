"""Builds public/cardinfo.json (cost, power, counter, life, attribute, traits, effect text per card code) for the Explore filters.
Source: optcgapi.com card lists (https://optcgapi.com/api/allSetCards/ and /api/allSTCards/), saved as JSON files.
Run: python tools/build_cardinfo.py <allSetCards.json> <allSTCards.json>
Format: {"OP01-001": [cost, power, counter, life, "Attribute", "Trait / Trait", "effect text"], ...}  (null where a card has none)
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
paths = sys.argv[1:] or ['C:/Users/admins/AppData/Local/hermes/cache/scratch/optcg_set.json', 'C:/Users/admins/AppData/Local/hermes/cache/scratch/optcg_st.json']
cat = json.load(open(os.path.join(HERE, '..', 'public', 'catalog.json'), encoding='utf-8'))['cards']
codes = {c[2] for c in cat}

def num(v):
    try: return int(str(v).replace(',', '')) if v not in (None, '', '-') else None
    except ValueError: return None

out = {}
for p in paths:
    for r in json.load(open(p, encoding='utf-8')):
        code = r.get('card_set_id')
        if code not in codes or code in out: continue
        txt = (r.get('card_text') or '').replace('\r', ' ').replace('\n', ' ').strip()
        out[code] = [num(r.get('card_cost')), num(r.get('card_power')), num(r.get('counter_amount')), num(r.get('life')), r.get('attribute') or None, (r.get('sub_types') or '').strip() or None, txt or None]
print('catalogue codes', len(codes), 'with details', len(out), '(%.0f%%)' % (100 * len(out) / len(codes)))
missing = sorted(codes - set(out)); print('missing sample', missing[:15])
json.dump(out, open(os.path.join(HERE, '..', 'public', 'cardinfo.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('wrote public/cardinfo.json', os.path.getsize(os.path.join(HERE, '..', 'public', 'cardinfo.json')) // 1024, 'KB')
